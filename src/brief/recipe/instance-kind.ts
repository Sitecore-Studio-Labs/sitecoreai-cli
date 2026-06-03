/**
 * The `brief` recipe kind — wires the Sitecore Content Operations
 * Brief instance API into the `sync` engine.
 *
 * `ref.id` is the brief's display NAME — recipes identify a brief by
 * name, not UUID, mirroring how `campaign` identifies a project. The
 * brief type is referenced by its stable codename (`briefTypeName`)
 * and resolved to a server id at push-time via `listBriefTypes`.
 *
 * `apply` is straight CRUD: `createBrief` when the brief is absent,
 * `updateBrief` (partial PUT) to converge an existing one. Repointing
 * an existing brief at a different brief type is refused — the Brief
 * API has no verified path for that.
 *
 * Three-way merge (0.4+): when `ctx.baselineStorage` is present, the
 * planner classifies each top-level element and each per-field value
 * as `first-push | recipe-change | cms-edit | conflict` against the
 * previous successful push's baseline, and consults
 * `ctx.pushConflictPolicy` to decide whether `cms-edit` and `conflict`
 * route to a recipe-wins clobber, a cms-wins skip, or a hard error.
 *
 * See docs/recipe-sync-architecture.md.
 */
import {
  createBrief,
  createBriefComment,
  createBriefTask,
  getBrief,
  listBriefTypes,
  listBriefs,
  updateBrief,
  type Brief,
  type BriefApiClientOptions,
  type BriefStatus,
  type BriefType,
  type CreateBriefInput,
} from "@/brief";
import { createScaiError } from "@/shared/errors";
import type {
  ApplyResult,
  Baseline,
  FieldClassification,
  KindRef,
  PushConflictPolicy,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  SyncContext,
} from "@/sync";
import { resolveBriefClient } from "./client";
import { diffBriefInstance } from "./instance-diff";
import {
  captureBriefBaselinePayload,
  classifyBriefValue,
  hashBriefValue,
  TOP_LEVEL_ELEMENTS,
  type BriefBaselinePayload,
  type TopLevelKey,
} from "./instance-baseline";
import { BriefInstanceRecipeSchema, type BriefInstanceRecipe } from "./instance-schema";

const BRIEF_KIND_NAME = "brief";

/**
 * Find a brief by its display name, paging the list endpoint until a
 * match is found or the cursor is exhausted. The Brief list endpoint
 * supports no server-side name filter (see `ListBriefsQuery`), so the
 * walk is unavoidable.
 */
const findBriefByName = async (
  client: BriefApiClientOptions,
  name: string
): Promise<Brief | null> => {
  let cursor: string | undefined;
  for (;;) {
    const page = await listBriefs(client, cursor ? { next: cursor } : undefined);
    const match = page.data.find((brief) => brief.name === name);
    if (match) return match;
    if (!page.next || page.data.length === 0) return null;
    cursor = page.next;
  }
};

/** Find a brief type by its codename (mirrors `briefTypeKind`'s helper). */
const findTypeByName = async (
  client: BriefApiClientOptions,
  name: string
): Promise<BriefType | null> => {
  const page = await listBriefTypes(client);
  return page.data.find((type) => type.name === name) ?? null;
};

/** Enumerate every brief on the remote — fans out into the aggregate sync. */
const list = async (ctx: SyncContext): Promise<KindRef[]> => {
  const client = await resolveBriefClient(ctx);
  const refs: KindRef[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listBriefs(client, cursor ? { next: cursor } : undefined);
    for (const brief of page.data) {
      refs.push({ kind: "brief", id: brief.name });
    }
    if (!page.next || page.data.length === 0) return refs;
    cursor = page.next;
  }
};

/** Project a live brief into the recipe shape, dropping server ids/metadata. */
const toRecipe = (brief: Brief, briefTypeName: string): BriefInstanceRecipe => ({
  name: brief.name,
  briefTypeName,
  locale: brief.locale || undefined,
  status: brief.status,
  isTemplate: brief.isTemplate,
  fields: brief.fields ?? {},
});

/**
 * Capture a live brief as a recipe. `null` when no brief has the name.
 *
 * The list endpoint omits the full nested `fields` map on some
 * envelopes, so the matched id is re-read via `getBrief` for fidelity.
 */
const readCurrent = async (ref: KindRef, ctx: SyncContext): Promise<BriefInstanceRecipe | null> => {
  const client = await resolveBriefClient(ctx);
  const found = await findBriefByName(client, ref.id);
  if (!found) return null;
  const brief = await getBrief(client, found.id);

  // Resolve the brief-type codename. The brief carries a `Link` to its
  // type with the id but not the codename, so a follow-up listTypes
  // resolves it. If the type has been deleted (orphan brief), surface
  // the id verbatim so the pulled recipe still round-trips.
  const types = await listBriefTypes(client);
  const briefTypeName =
    types.data.find((type) => type.id === brief.briefType.id)?.name ?? brief.briefType.id;

  return toRecipe(brief, briefTypeName);
};

/** Resolve a recipe's `briefTypeName` to the full type record (id + field defs), or fail with a hint. */
const resolveBriefType = async (
  client: BriefApiClientOptions,
  briefTypeName: string
): Promise<BriefType> => {
  const type = await findTypeByName(client, briefTypeName);
  if (!type) {
    throw createScaiError(`Brief type "${briefTypeName}" not found.`, "INPUT_INVALID", {
      hint: "Push the brief-type recipe first, or check the `briefTypeName` codename with `scai ops brief types list`.",
    });
  }
  return type;
};

/**
 * Convert an HTML-ish string into a minimal-but-valid ProseMirror doc.
 * The Brief API stores RichText as a ProseMirror document; raw HTML
 * strings fail validation with
 * `Unexpected character encountered while parsing value: <`.
 *
 * Lossy — block-level only, drops inline formatting (bold/italic/
 * links etc.). Adequate for first-push of LLM-generated briefs where
 * the content is plain prose; richer formatting needs the brief
 * editor on the Sitecore side OR a real HTML→ProseMirror converter
 * (e.g. prosemirror-model + DOMParser, which scai doesn't ship).
 *
 * Empty input → empty doc `{type: "doc", content: []}` (also accepted).
 */
const htmlToProseMirrorDoc = (html: string): Record<string, unknown> => {
  const plain = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const paragraphs = plain
    .split(/\n\s*\n|\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return { type: "doc", content: [] };
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
};

/**
 * Wrap a recipe's `fields` map with the `{type, value}` shape the
 * Brief API requires on create/update. Unwrapped values (raw `{amount,
 * currency}` for Budget, HTML strings for RichText, etc.) are common
 * in recipes built from LLM output or the orchestrator's StoryBrief
 * shape; without wrapping the API returns either
 * `Missing 'type' property for field: <name>` or, for RichText with a
 * string value, `Unexpected character encountered while parsing value`.
 *
 * Idempotent: values that already have `{type, value}` pass through
 * untouched so round-tripped recipes (pull → push) don't double-wrap.
 *
 * RichText values that are HTML strings get a lossy block-level
 * conversion to a ProseMirror doc — see `htmlToProseMirrorDoc`.
 *
 * Unknown field names (in the recipe but not on the type) pass through
 * as-is — the server rejects them with a clearer "field not on type"
 * error than scai could synthesize.
 */
const wrapBriefFields = (
  fields: Record<string, unknown> | undefined,
  briefType: BriefType
): Record<string, unknown> => {
  if (!fields) return {};
  const typeByName = new Map<string, string>(briefType.fields.map((f) => [f.name, f.type]));
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    const fieldType = typeByName.get(name);
    if (!fieldType) {
      wrapped[name] = value;
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "type" in value &&
      "value" in value
    ) {
      wrapped[name] = value; // already wrapped
      continue;
    }
    // RichText fields can't accept a bare string — convert to a
    // minimal ProseMirror doc. Other types pass the value through as
    // the wrapped `value`.
    let wireValue: unknown = value;
    if (fieldType === "RichText" && typeof value === "string") {
      wireValue = htmlToProseMirrorDoc(value);
    }
    wrapped[name] = { type: fieldType, value: wireValue };
  }
  return wrapped;
};

/**
 * Result of merging desired/current/baseline per the chosen policy.
 * `merged` is the recipe `apply` will write; `policyErrors` enumerates
 * any `cms-edit`/`conflict` cells when the policy is `error`.
 */
interface MergeOutcome {
  merged: BriefInstanceRecipe;
  perElement: Partial<Record<TopLevelKey, FieldClassification>>;
  perField: Record<string, FieldClassification>;
  policyErrors: Array<{ path: string; classification: FieldClassification }>;
}

/**
 * Apply per-element + per-field three-way classification, honoring
 * the conflict policy. Without baseline, every divergence reads as
 * `first-push` and the desired value wins (two-way diff behaviour).
 */
const mergeWithPolicy = (
  desired: BriefInstanceRecipe,
  current: BriefInstanceRecipe,
  baselinePayload: BriefBaselinePayload | undefined,
  policy: PushConflictPolicy
): MergeOutcome => {
  const perElement: Partial<Record<TopLevelKey, FieldClassification>> = {};
  const perField: Record<string, FieldClassification> = {};
  const policyErrors: MergeOutcome["policyErrors"] = [];

  const resolveValue = <T>(
    classification: FieldClassification,
    desiredVal: T,
    currentVal: T,
    path: string
  ): T => {
    if (classification === "cms-edit" || classification === "conflict") {
      if (policy === "cms-wins") return currentVal;
      if (policy === "error") {
        policyErrors.push({ path, classification });
        return desiredVal;
      }
      // recipe-wins: clobber tenant.
      return desiredVal;
    }
    // recipe-change / first-push / noop: desired is safe.
    return desiredVal;
  };

  const merged: BriefInstanceRecipe = { ...desired };

  // Top-level element classification — `briefTypeName`, `locale`,
  // `status`, `isTemplate`. Each is a scalar; hash the value, classify,
  // resolve per policy.
  for (const element of TOP_LEVEL_ELEMENTS) {
    const desiredVal = desired[element];
    const currentVal = current[element];
    const desiredHash = hashBriefValue(desiredVal);
    const currentHash = hashBriefValue(currentVal);
    const classification = classifyBriefValue(
      desiredHash,
      currentHash,
      baselinePayload?.elements[element]
    );
    perElement[element] = classification;
    const resolved = resolveValue(classification, desiredVal, currentVal, `brief.${element}`);
    // Element types: `briefTypeName` is required, the others optional.
    if (element === "briefTypeName") {
      merged.briefTypeName = resolved as string;
    } else if (element === "locale") {
      merged.locale = resolved as string | undefined;
    } else if (element === "status") {
      merged.status = resolved as BriefStatus | undefined;
    } else {
      merged.isTemplate = resolved as boolean | undefined;
    }
  }

  // Per-field classification inside `fields`. Union of names across
  // desired + current so we don't miss a tenant-only field — but we
  // also don't ADD tenant-only fields to the merged recipe under
  // recipe-wins / first-push (those are recipe author's province).
  const desiredFields = desired.fields ?? {};
  const currentFields = current.fields ?? {};
  const allNames = new Set([...Object.keys(desiredFields), ...Object.keys(currentFields)]);
  const mergedFields: Record<string, unknown> = {};
  for (const name of allNames) {
    const inDesired = Object.prototype.hasOwnProperty.call(desiredFields, name);
    const inCurrent = Object.prototype.hasOwnProperty.call(currentFields, name);
    const desiredVal = desiredFields[name];
    const currentVal = currentFields[name];
    const desiredHash = inDesired ? hashBriefValue(desiredVal) : hashBriefValue(undefined);
    const currentHash = inCurrent ? hashBriefValue(currentVal) : hashBriefValue(undefined);
    const classification = classifyBriefValue(
      desiredHash,
      currentHash,
      baselinePayload?.fields[name]
    );
    perField[name] = classification;
    const resolved = resolveValue(classification, desiredVal, currentVal, `brief.fields.${name}`);
    // Only include the field in the merged recipe when SOMEONE
    // produced a value for it. cms-wins skip of a tenant-only field
    // (not in desired) → include it (preserves tenant). recipe-wins
    // of a tenant-only field → exclude it (recipe authoritative).
    if (resolved !== undefined) {
      mergedFields[name] = resolved;
    } else if (inDesired || inCurrent) {
      // Explicit undefined survives if either side set it.
      mergedFields[name] = undefined;
    }
  }
  merged.fields = mergedFields;

  return { merged, perElement, perField, policyErrors };
};

/** Apply a plan — create the brief, or PUT-patch it onto the desired state. */
const apply = async (plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult> => {
  const client = await resolveBriefClient(ctx);
  const applied: RecipeChange[] = [];
  const skipped: RecipeChange[] = [];

  // The single `stage: "instance"` change carries the full desired
  // recipe; per-element `stage: "field"` changes are descriptive only.
  const instanceChange = plan.changes.find((change) => change.meta?.stage === "instance");
  if (!instanceChange) {
    // Nothing to write — an all-noop plan.
    for (const change of plan.changes) skipped.push(change);
    return { applied, skipped };
  }

  // Plan stamps `meta.policyError = true` on the instance change when
  // any cell classified as `cms-edit` / `conflict` and the policy is
  // `"error"`. Refuse to write — operator must resolve before retry.
  if (instanceChange.meta?.policyError === true) {
    const errors =
      (instanceChange.meta?.policyErrors as
        | Array<{ path: string; classification: string }>
        | undefined) ?? [];
    throw createScaiError(
      `Brief "${ref.id}" has ${errors.length} unresolved three-way merge conflict(s).`,
      "POLICY_DENIED",
      {
        hint: "Re-run with `conflictPolicy: 'cms-wins'` (preserve Sitecore AI edits) or `'recipe-wins'` (clobber). Or pull the brief first to converge the recipe against the tenant.",
        details: errors.map((e) => `${e.path} → ${e.classification}`),
      }
    );
  }

  const recipe = instanceChange.meta?.recipe as BriefInstanceRecipe | undefined;
  if (!recipe) {
    throw createScaiError("Brief plan change is missing its recipe payload.", "INPUT_INVALID", {
      hint: "This is an internal diff error — change.meta.recipe was not set.",
    });
  }

  let writtenRecipe: BriefInstanceRecipe = recipe;
  let writtenBriefId: string | null = null;
  if (instanceChange.kind === "create") {
    const briefType = await resolveBriefType(client, recipe.briefTypeName);
    const wrappedFields = wrapBriefFields(recipe.fields, briefType);
    const input: CreateBriefInput = {
      name: recipe.name,
      briefTypeId: briefType.id,
      ...(recipe.locale !== undefined && { locale: recipe.locale }),
      ...(Object.keys(wrappedFields).length > 0 && { fields: wrappedFields }),
      ...(recipe.isTemplate !== undefined && { isTemplate: recipe.isTemplate }),
    };
    ctx.logger?.info(`Creating brief "${recipe.name}".`);
    const created = await createBrief(client, input);
    writtenBriefId = created.id;

    // `createBrief` accepts no `status` field — POSTs land in the
    // server default ("Draft"). If the recipe pins a different status,
    // converge with a follow-up PUT so the post-apply state matches.
    if (recipe.status && recipe.status !== created.status) {
      ctx.logger?.info(`Setting brief "${recipe.name}" status to "${recipe.status}".`);
      await updateBrief(client, created.id, { status: recipe.status });
    }
  } else {
    const existing = await findBriefByName(client, ref.id);
    if (!existing) {
      throw createScaiError(`Brief "${ref.id}" not found.`, "INPUT_INVALID", {
        hint: "The brief was expected to exist for an update — check the name or push a create.",
      });
    }
    // The Brief API has no verified path to repoint a brief at a
    // different type. Surface that loudly instead of silently dropping
    // the change.
    const types = await listBriefTypes(client);
    const existingType = types.data.find((type) => type.id === existing.briefType.id);
    const existingTypeName = existingType?.name ?? existing.briefType.id;
    if (existingTypeName !== recipe.briefTypeName) {
      throw createScaiError(
        `Cannot repoint brief "${recipe.name}" from type "${existingTypeName}" to "${recipe.briefTypeName}".`,
        "INPUT_INVALID",
        {
          hint: "The Brief API has no verified path to change a brief's type. Delete and recreate the brief, or correct the recipe's briefTypeName.",
        }
      );
    }
    // Wrap fields using the existing brief-type's field definitions
    // when we have them (we should — we just listed the types). Same
    // {type, value} requirement as create; without this an update with
    // unwrapped Budget/Timeline/etc. round-trips a 400.
    const wrappedFields = existingType
      ? wrapBriefFields(recipe.fields, existingType)
      : (recipe.fields ?? {});
    const patch: Partial<CreateBriefInput> & { status?: BriefStatus } = {
      name: recipe.name,
      ...(recipe.locale !== undefined && { locale: recipe.locale }),
      ...(recipe.isTemplate !== undefined && { isTemplate: recipe.isTemplate }),
      ...(recipe.status !== undefined && { status: recipe.status }),
      fields: wrappedFields,
    };
    ctx.logger?.info(`Updating brief "${recipe.name}" (${existing.id}).`);
    await updateBrief(client, existing.id, patch);
    writtenBriefId = existing.id;
  }
  applied.push(instanceChange);

  // Sub-resource creates: todos + comments. The Brief API exposes
  // these as separate POST endpoints (no inline write on the brief
  // itself). Create-only for now — re-pushing a recipe doesn't
  // dedup against existing tasks/comments. Failure on a single sub-
  // resource doesn't roll back the brief: log + continue, so a
  // misconfigured comment authorId doesn't lose the whole push.
  if (writtenBriefId && recipe.todos && recipe.todos.length > 0) {
    ctx.logger?.info(`Posting ${recipe.todos.length} to-do(s) to brief "${recipe.name}".`);
    for (const todo of recipe.todos) {
      try {
        await createBriefTask(client, {
          briefId: writtenBriefId,
          title: todo.title,
          ...(todo.assigneeIds && todo.assigneeIds.length > 0
            ? { assigneeIds: todo.assigneeIds }
            : {}),
        });
      } catch (err) {
        ctx.logger?.warn?.(
          `Failed to post to-do "${todo.title}" on brief "${recipe.name}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }
  if (writtenBriefId && recipe.comments && recipe.comments.length > 0) {
    ctx.logger?.info(`Posting ${recipe.comments.length} comment(s) to brief "${recipe.name}".`);
    for (const comment of recipe.comments) {
      try {
        await createBriefComment(client, {
          briefId: writtenBriefId,
          text: comment.text,
          authorId: comment.authorId,
        });
      } catch (err) {
        ctx.logger?.warn?.(
          `Failed to post comment by ${comment.authorId} on brief "${recipe.name}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  // Per-element changes are converged by the single PUT (or POST).
  for (const change of plan.changes) {
    if (change === instanceChange) continue;
    if (change.kind === "noop") skipped.push(change);
    else applied.push(change);
  }

  // Three-way merge baseline capture: write the post-apply hash map so
  // the next push can classify drift. Storage opt-in via
  // `ctx.baselineStorage`; without it, the kind operates in two-way
  // mode and never writes baselines.
  if (ctx.baselineStorage) {
    const payload = captureBriefBaselinePayload(writtenRecipe);
    const baseline: Baseline<BriefBaselinePayload> = {
      envelopeVersion: "1",
      kind: BRIEF_KIND_NAME,
      recipeHandle: ref.id,
      envName: ctx.environmentName,
      capturedAt: new Date().toISOString(),
      payload,
    };
    try {
      await ctx.baselineStorage.write(BRIEF_KIND_NAME, ctx.environmentName, ref.id, baseline);
    } catch (err) {
      // Baseline write failures must not silently fall back to two-way
      // mode on the next push — that re-introduces silent-clobber. Log
      // but don't throw: the brief WAS successfully written, and the
      // caller can decide whether to surface this. Aligns with content-
      // recipe runtime's behaviour for baseline-write errors.
      ctx.logger?.error?.(
        `Brief baseline write failed for "${ref.id}" — next push will operate in two-way mode: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return { applied, skipped };
};

/**
 * Compute the plan to converge a brief onto `desired`. Loads the
 * baseline + reads tenant, three-way merges per
 * `ctx.pushConflictPolicy` (default `"error"` — the kind never silently
 * clobbers; callers wanting the orchestrator's `cms-wins` story-sync
 * default must set it explicitly), then feeds the merged recipe
 * through the existing two-way diff for change-set construction.
 *
 * Without `ctx.baselineStorage`, the kind degrades to two-way diff
 * behaviour: every tenant divergence reads as `first-push` and the
 * desired value wins.
 */
const plan = async (
  desired: BriefInstanceRecipe,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => {
  const current = await readCurrent(ref, ctx);

  // Fresh create — no baseline needed, no tenant state to merge.
  if (current === null) return diffBriefInstance(desired, null);

  // Load baseline if storage is plugged in; without it, the merge
  // sees `baselinePayload: undefined` and everything classifies as
  // `first-push` (two-way diff equivalent).
  let baselinePayload: BriefBaselinePayload | undefined;
  if (ctx.baselineStorage) {
    const loaded = await ctx.baselineStorage.load<BriefBaselinePayload>(
      BRIEF_KIND_NAME,
      ctx.environmentName,
      ref.id
    );
    baselinePayload = loaded?.payload;
  }

  const policy: PushConflictPolicy = ctx.pushConflictPolicy ?? "error";
  const outcome = mergeWithPolicy(desired, current, baselinePayload, policy);

  const basePlan = diffBriefInstance(outcome.merged, current);

  // Annotate per-element changes with their classification + the lead
  // instance change with the policy outcome. Consumers (UI, logs, MCP
  // structured output) can read these without re-running the merge.
  for (const change of basePlan.changes) {
    if (change.meta?.stage === "field") {
      const element = change.meta.element as TopLevelKey | "fields" | undefined;
      if (element && element !== "fields" && outcome.perElement[element]) {
        change.meta = { ...change.meta, classification: outcome.perElement[element] };
      }
      // For the coarse `fields` element, surface the per-field map so
      // callers can drill in without re-hashing.
      if (element === "fields") {
        change.meta = { ...change.meta, perFieldClassification: outcome.perField };
      }
    } else if (change.meta?.stage === "instance") {
      change.meta = {
        ...change.meta,
        recipe: outcome.merged,
        ...(outcome.policyErrors.length > 0 && {
          policyError: true,
          policyErrors: outcome.policyErrors,
        }),
      };
    }
  }

  return basePlan;
};

/** The `brief` recipe kind. */
export const briefInstanceKind: RecipeKind<BriefInstanceRecipe> = {
  name: "brief",
  schema: BriefInstanceRecipeSchema,
  readCurrent,
  plan,
  apply,
  list,
};
