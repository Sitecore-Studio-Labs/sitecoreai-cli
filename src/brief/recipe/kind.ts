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
  listBriefTypes,
  updateBriefType,
  type BriefApiClientOptions,
  type BriefField,
  type BriefType,
  type CreateBriefTypeInput,
} from "@/brief";
import { createScaiError } from "@/shared/errors";
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

/** Apply a plan — straight CRUD: create the type, or PUT-replace it. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = await resolveBriefClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  // Plan stamps `meta.policyError = true` on the lead `stage: "type"`
  // change when any cell classified as `cms-edit` / `conflict` and the
  // policy is `"error"`. Refuse to write before any I/O so the operator
  // resolves before retry.
  const policyErrorChange = plan.changes.find((change) => change.meta?.policyError === true);
  if (policyErrorChange) {
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
  }

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

  if (typeChange.kind === "create") {
    ctx.logger?.info(`Creating brief type "${recipe.name}".`);
    await createBriefType(client, input);
    applied.push(typeChange);
  } else if (typeChange.kind === "update") {
    const existing = await findTypeByName(client, ref.id);
    if (!existing) {
      throw createScaiError(`Brief type "${ref.id}" not found.`, "INPUT_INVALID", {
        hint: "The type was expected to exist for an update — check the name or push a create.",
      });
    }
    ctx.logger?.info(`Updating brief type "${recipe.name}" (${existing.id}).`);
    await updateBriefType(client, existing.id, input);
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

  // Three-way merge baseline capture: write the post-apply hash map so
  // the next push can classify drift. Storage opt-in via
  // `ctx.baselineStorage`; without it, the kind operates in two-way
  // mode and never writes baselines. Hash the recipe the kind actually
  // wrote (the merged value), not the raw operator-authored desired,
  // so a cms-wins downgrade lands an accurate baseline.
  if (ctx.baselineStorage) {
    const payload = captureBriefTypeBaselinePayload(recipe);
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
  }

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
const plan = async (
  desired: BriefTypeRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => {
  const current = await readCurrent(ref, ctx);

  // Fresh create — no baseline needed, no tenant state to merge.
  if (current === null) return diffBriefType(desired, null);

  // Load baseline if storage is plugged in; without it, the merge sees
  // `baselinePayload: undefined` and everything classifies as
  // `first-push` (two-way diff equivalent).
  let baselinePayload: BriefTypeBaselinePayload | undefined;
  if (ctx.baselineStorage) {
    const loaded = await ctx.baselineStorage.load<BriefTypeBaselinePayload>(
      BRIEF_TYPE_KIND_NAME,
      ctx.environmentName,
      ref.id
    );
    baselinePayload = loaded?.payload;
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
      const element = change.meta.element;
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
