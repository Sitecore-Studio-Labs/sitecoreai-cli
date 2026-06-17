/**
 * The `brief-type` recipe kind — wires the Sitecore Content Operations
 * Brief API into the `sync` engine.
 *
 * `ref.id` is the brief type's NAME (its stable codename) — recipes
 * identify a type by name, not UUID. `readCurrent` resolves it to a live
 * brief type; `apply` is straight CRUD: `createBriefType` when the type
 * is absent, `updateBriefType` (full-replacement PUT) to converge an
 * existing one. Brief types have no ingestion/pipeline/orchestration,
 * unlike brand kits — `apply` stays simple.
 *
 * Three-way merge (0.3+): when `ctx.baselineStorage` is present, the
 * planner classifies each top-level scalar and each per-field cell as
 * `first-push | recipe-change | cms-edit | conflict` against the
 * previous successful push's baseline, and consults
 * `ctx.pushConflictPolicy` to decide whether `cms-edit` and `conflict`
 * route to a recipe-wins clobber, a cms-wins skip, or a hard error.
 * Without `ctx.baselineStorage` the kind degrades to the two-way diff
 * it shipped with — every tenant divergence reads as `first-push` and
 * the desired value wins.
 *
 * See docs/recipe-sync-architecture.md.
 */
import {
  createBriefType,
  getBriefType,
  listBriefTypes,
  updateBriefType,
  type BriefApiClientOptions,
  type BriefField,
  type BriefType,
  type CreateBriefTypeInput,
} from "@/brief";
import { createScaiError } from "@/shared/errors";
import { resolveMissingCurrentPlan } from "@/sync";
import type {
  ApplyResult,
  Baseline,
  KindRef,
  PushConflictPolicy,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  SyncContext,
} from "@/sync";
import {
  captureBriefTypeBaselinePayload,
  classifyBriefTypeCells,
  mergeBriefTypeByPolicy,
  type BriefTypeBaselinePayload,
} from "./baseline";
import { resolveBriefClient } from "./client";
import { diffBriefType } from "./diff";
import { BriefTypeRecipeSchema, type BriefRecipeField, type BriefTypeRecipe } from "./schema";

const BRIEF_TYPE_KIND_NAME = "brief-type";

/** Find a brief type by its codename. `null` when none matches. */
const findTypeByName = async (
  client: BriefApiClientOptions,
  name: string
): Promise<BriefType | null> => {
  const page = await listBriefTypes(client);
  return page.data.find((type) => type.name === name) ?? null;
};

/** Enumerate every brief type on the remote. */
const list = async (ctx: SyncContext): Promise<KindRef[]> => {
  const client = await resolveBriefClient(ctx);
  const page = await listBriefTypes(client);
  return page.data.map((type) => ({ kind: "brief-type", id: type.name }));
};

/** Project a live brief-type field into the clean recipe shape. */
const toRecipeField = (field: BriefField): BriefRecipeField => field as BriefRecipeField;

/** Project a live brief type into the recipe shape, dropping server ids. */
const toRecipe = (type: BriefType): BriefTypeRecipe => ({
  name: type.name,
  label: type.label,
  description: type.description,
  icon: type.icon,
  iconColor: type.iconColor,
  fields: type.fields.map(toRecipeField),
});

/** Convert a recipe into the Brief API's create/update write shape. */
const toApiInput = (recipe: BriefTypeRecipe): CreateBriefTypeInput => ({
  name: recipe.name,
  label: recipe.label,
  description: recipe.description,
  icon: recipe.icon,
  iconColor: recipe.iconColor,
  fields: recipe.fields as BriefField[],
});

/** Capture a live brief type as a recipe. `null` when no type has the name. */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<BriefTypeRecipe | null> => {
  const client = await resolveBriefClient(ctx);
  const type = await findTypeByName(client, ref.id);
  return type ? toRecipe(type) : null;
};

/**
 * Prefer-id read: when a baseline-captured `tenantId` is available,
 * fetch the row by id first. Falls back to the name-based read when
 * the id either isn't provided or no longer resolves (the row was
 * deleted on the tenant side). Survives a recipe codename rename —
 * the id still maps to the existing brief-type row.
 */
const readCurrentByIdOrName = async (
  _desired: BriefTypeRecipe,
  ref: KindRef,
  ctx: SyncContext,
  tenantId: string | undefined
): Promise<BriefTypeRecipe | null> => {
  if (tenantId) {
    try {
      const client = await resolveBriefClient(ctx);
      const type = await getBriefType(client, tenantId);
      if (type) return toRecipe(type);
    } catch {
      // 404 / network — fall through to name-based read.
    }
  }
  return readCurrent(ref, ctx);
};

/**
 * Refuse to write when the plan stamped a `meta.policyError` — any cell
 * classified `cms-edit` / `conflict` under the `"error"` policy. Throws
 * before any I/O so the operator resolves before retry.
 */
const assertNoPolicyError = (plan: RecipePlan, ref: KindRef): void => {
  const policyErrorChange = plan.changes.find((change) => change.meta?.policyError === true);
  if (!policyErrorChange) return;
  const errors =
    (policyErrorChange.meta?.policyErrors as
      | Array<{ path: string; classification: string }>
      | undefined) ?? [];
  throw createScaiError(
    `Brief type "${ref.id}" has ${errors.length} unresolved three-way merge conflict(s).`,
    "POLICY_DENIED",
    {
      hint: "Re-run with `conflictPolicy: 'cms-wins'` (preserve Sitecore AI edits) or `'recipe-wins'` (clobber). Or pull the brief type first to converge the recipe against the tenant.",
      details: errors.map((e) => `${e.path} → ${e.classification}`),
    }
  );
};

/**
 * Best-effort read of the prior baseline's captured tenant id. Used to
 * resolve the existing row by id (robust to a codename rename) before
 * falling back to a name lookup. `undefined` when storage is absent or
 * the load fails.
 */
const loadPriorBaselineTenantId = async (
  ctx: SyncContext,
  ref: KindRef
): Promise<string | undefined> => {
  if (!ctx.baselineStorage) return undefined;
  try {
    const prior = await ctx.baselineStorage.load<BriefTypeBaselinePayload>(
      BRIEF_TYPE_KIND_NAME,
      ctx.environmentName,
      ref.id
    );
    return prior?.payload?.tenantId;
  } catch {
    // Best-effort — baseline load failure just disables id-first.
    return undefined;
  }
};

/** Fetch a brief type by id, swallowing 404 / network errors as `null`. */
const tryGetBriefTypeById = async (
  client: BriefApiClientOptions,
  id: string
): Promise<BriefType | null> => {
  try {
    return await getBriefType(client, id);
  } catch {
    return null;
  }
};

/**
 * Apply a `create` type change. A prior baseline-stored id wins even
 * for a fresh-create plan — the row exists, the recipe just forgot it —
 * so this adopts via update when the id resolves. Returns the written
 * tenant id.
 */
const applyCreate = async (
  client: BriefApiClientOptions,
  ctx: SyncContext,
  recipe: BriefTypeRecipe,
  input: CreateBriefTypeInput,
  priorBaselineTenantId: string | undefined
): Promise<string> => {
  const adopted = priorBaselineTenantId
    ? await tryGetBriefTypeById(client, priorBaselineTenantId)
    : null;
  if (adopted) {
    ctx.logger?.info(
      `Adopting existing brief type "${adopted.name}" (id ${adopted.id}) via baseline tenantId — recipe codename "${recipe.name}" was a rename.`
    );
    await updateBriefType(client, adopted.id, input);
    return adopted.id;
  }
  ctx.logger?.info(`Creating brief type "${recipe.name}".`);
  const created = await createBriefType(client, input);
  return created.id;
};

/**
 * Apply an `update` type change. Prefers the baseline-stored tenant id
 * over a name lookup (robust to a codename rename), throwing when no row
 * resolves. Returns the written tenant id.
 */
const applyUpdate = async (args: {
  client: BriefApiClientOptions;
  ctx: SyncContext;
  ref: KindRef;
  recipe: BriefTypeRecipe;
  input: CreateBriefTypeInput;
  priorBaselineTenantId: string | undefined;
}): Promise<string> => {
  const { client, ctx, ref, recipe, input, priorBaselineTenantId } = args;
  let existing = priorBaselineTenantId
    ? await tryGetBriefTypeById(client, priorBaselineTenantId)
    : null;
  if (!existing) {
    existing = await findTypeByName(client, ref.id);
  }
  if (!existing) {
    throw createScaiError(`Brief type "${ref.id}" not found.`, "INPUT_INVALID", {
      hint: "The type was expected to exist for an update — check the name or push a create.",
    });
  }
  ctx.logger?.info(`Updating brief type "${recipe.name}" (${existing.id}).`);
  await updateBriefType(client, existing.id, input);
  return existing.id;
};

/**
 * Three-way merge baseline capture: write the post-apply hash map so the
 * next push can classify drift. Opt-in via `ctx.baselineStorage`. Hashes
 * the merged recipe the kind actually wrote (so a cms-wins downgrade
 * lands an accurate baseline), falling back to the prior baseline id on
 * a noop run. Write failures are logged, never thrown.
 */
const captureBaseline = async (
  ctx: SyncContext,
  ref: KindRef,
  recipe: BriefTypeRecipe,
  tenantId: string | undefined
): Promise<void> => {
  if (!ctx.baselineStorage) return;
  const payload = captureBriefTypeBaselinePayload(recipe, tenantId);
  const baseline: Baseline<BriefTypeBaselinePayload> = {
    envelopeVersion: "1",
    kind: BRIEF_TYPE_KIND_NAME,
    recipeHandle: ref.id,
    envName: ctx.environmentName,
    capturedAt: new Date().toISOString(),
    payload,
  };
  try {
    await ctx.baselineStorage.write(BRIEF_TYPE_KIND_NAME, ctx.environmentName, ref.id, baseline);
  } catch (err) {
    // Baseline write failures must not silently fall back to two-way
    // mode on the next push — that re-introduces silent-clobber. Log
    // but don't throw: the type WAS successfully written, and the
    // caller can decide whether to surface this. Mirrors the brief
    // instance + brand-kit behaviour.
    ctx.logger?.error?.(
      `Brief-type baseline write failed for "${ref.id}" — next push will operate in two-way mode: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
};

/** Apply a plan — straight CRUD: create the type, or PUT-replace it. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = await resolveBriefClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  assertNoPolicyError(plan, ref);

  // The single `stage: "type"` change carries the full desired recipe;
  // per-element `stage: "field"` changes are descriptive only.
  const typeChange = plan.changes.find((change) => change.meta?.stage === "type");
  if (!typeChange) {
    // Nothing to write — an all-noop plan.
    for (const change of plan.changes) skipped.push(change);
    return { applied, skipped };
  }

  const recipe = typeChange.meta?.recipe as BriefTypeRecipe | undefined;
  if (!recipe) {
    throw createScaiError(
      "Brief-type plan change is missing its recipe payload.",
      "INPUT_INVALID",
      { hint: "This is an internal diff error — the change.meta.recipe field was not set." }
    );
  }
  const input = toApiInput(recipe);

  // If the baseline already carries a tenantId from a prior push,
  // resolve the row by id first — handles the codename-rename case
  // (the recipe's `ref.id` is the NEW codename, but the existing
  // tenant row still carries the OLD one).
  const priorBaselineTenantId = await loadPriorBaselineTenantId(ctx, ref);

  // Capture the tenant id of whichever row this apply lands on, so the
  // baseline write below can stamp it.
  let writtenTenantId: string | undefined;
  if (typeChange.kind === "create") {
    writtenTenantId = await applyCreate(client, ctx, recipe, input, priorBaselineTenantId);
    applied.push(typeChange);
  } else if (typeChange.kind === "update") {
    writtenTenantId = await applyUpdate({ client, ctx, ref, recipe, input, priorBaselineTenantId });
    applied.push(typeChange);
  } else {
    // `noop` typeChange — surfaces a post-merge state that equals the
    // tenant's current state (e.g. cms-wins resolved every cms-edit to
    // tenant). No PUT needed; the change is informational. Still mark
    // it skipped so the apply ledger is honest.
    skipped.push(typeChange);
  }

  // Per-element changes are converged by the single whole-record write
  // (when one happens). For an all-noop merged plan they're all skips.
  for (const change of plan.changes) {
    if (change === typeChange) continue;
    if (change.kind === "noop") skipped.push(change);
    else applied.push(change);
  }

  // Fall back to the prior baseline's tenantId when this run was a noop
  // (no create/update call to learn from) — preserves the captured id.
  await captureBaseline(ctx, ref, recipe, writtenTenantId ?? priorBaselineTenantId);

  return { applied, skipped };
};

/**
 * Compute the plan to converge a brief type onto `desired`. With
 * `ctx.baselineStorage` plugged in, classifies every scalar + every
 * per-field cell three-way (recipe vs tenant vs baseline), merges per
 * `ctx.pushConflictPolicy`, then feeds the merged recipe through
 * `diffBriefType`. Without baseline storage, degrades to the existing
 * two-way diff (every divergence reads as `first-push`, desired wins).
 *
 * Per-field changes carry their per-cell classification on
 * `change.meta.classification`. Policy-error blocks ride on the lead
 * `stage: "type"` change so apply can refuse before any writes; when
 * the diff produced no writing change (all-noop merged recipe) we
 * still surface the policy error on the first available change so
 * the apply throws rather than silently no-oping past the conflict.
 */
/**
 * Annotate a single `stage: "field"` change with its per-cell
 * classification. The coarse `briefType.fields` array change gets a
 * per-field map; a named single-field change gets its scalar
 * classification. Mutates `change.meta` in place.
 */
const annotateFieldChangeClassification = (
  change: RecipeChange,
  classifications: ReturnType<typeof classifyBriefTypeCells>
): void => {
  const element = change.meta?.element;
  if (element === "fields") {
    // The diff emits a single coarse `briefType.fields` change for
    // the whole array; surface the per-field map so callers can
    // drill in without re-hashing.
    const perField: Record<string, string> = {};
    for (const [path, cls] of Object.entries(classifications)) {
      if (path.startsWith("fields.")) perField[path.slice("fields.".length)] = cls;
    }
    change.meta = { ...change.meta, perFieldClassification: perField };
  } else if (typeof element === "string") {
    const cls = classifications[element];
    if (cls) change.meta = { ...change.meta, classification: cls };
  }
};

const plan = async (
  desired: BriefTypeRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => {
  // Load baseline FIRST so we can use any stored tenant id to resolve
  // the existing row before the name lookup. Survives a codename
  // refactor (rename) — without the id-first path, a name change
  // makes findTypeByName miss and the recipe would create a new
  // brief-type instead of updating the existing one.
  let baselinePayload: BriefTypeBaselinePayload | undefined;
  if (ctx.baselineStorage) {
    const loaded = await ctx.baselineStorage.load<BriefTypeBaselinePayload>(
      BRIEF_TYPE_KIND_NAME,
      ctx.environmentName,
      ref.id
    );
    baselinePayload = loaded?.payload;
  }

  let current = await readCurrentByIdOrName(desired, ref, ctx, baselinePayload?.tenantId);

  // Whole-entity deletion (or fresh create) — resolved by policy via the
  // shared helper: recreate / honor-deletion / surface.
  if (current === null) {
    return resolveMissingCurrentPlan({
      kindName: BRIEF_TYPE_KIND_NAME,
      ref,
      ctx,
      entityLabel: "Brief type",
      recreate: () => diffBriefType(desired, null),
    });
  }

  const policy: PushConflictPolicy = ctx.pushConflictPolicy ?? "error";
  const classifications = classifyBriefTypeCells(desired, current, baselinePayload);
  const { merged, policyErrors } = mergeBriefTypeByPolicy(
    desired,
    current,
    classifications,
    policy
  );

  const basePlan = diffBriefType(merged, current);

  // When the merged recipe equals current (e.g. cms-wins resolved every
  // cms-edit cell to the tenant value), the diff emits per-element
  // noops but no `stage: "type"` change. We still want apply to know
  // the merged recipe so it can refresh the baseline (the merge IS a
  // resolution event — without the baseline refresh the same drift
  // re-surfaces on the next push). Synthesize a noop `stage: "type"`
  // change carrying the merged recipe so apply has the payload.
  if (!basePlan.changes.find((change) => change.meta?.stage === "type")) {
    basePlan.changes.unshift({
      kind: "noop",
      path: "briefType",
      summary: `Brief type "${desired.name}" unchanged (post-merge).`,
      meta: { stage: "type", recipe: merged },
    });
  }

  // Annotate per-element changes with their classification + the lead
  // type change with the policy outcome. Consumers (UI, logs, MCP
  // structured output) can read these without re-running the merge.
  for (const change of basePlan.changes) {
    if (change.meta?.stage === "field") {
      annotateFieldChangeClassification(change, classifications);
    }
  }

  if (policyErrors.length > 0) {
    const carrier = basePlan.changes.find((c) => c.meta?.stage === "type") ?? basePlan.changes[0];
    if (carrier) {
      carrier.meta = { ...carrier.meta, policyError: true, policyErrors };
    } else {
      // Degenerate: the merged recipe matched current so diffBriefType
      // emitted no changes at all. Still surface the policy error so
      // an apply against this plan throws instead of silently no-oping.
      basePlan.changes.push({
        kind: "noop",
        path: "briefType",
        summary: `Brief type "${desired.name}" has unresolved three-way merge conflicts.`,
        meta: { stage: "type", policyError: true, policyErrors },
      });
    }
  }

  return basePlan;
};

/** The `brief-type` recipe kind. */
export const briefTypeKind: RecipeKind<BriefTypeRecipe> = {
  name: "brief-type",
  schema: BriefTypeRecipeSchema,
  readCurrent,
  plan,
  apply,
  list,
};
