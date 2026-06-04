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
  deleteBriefTask,
  getBrief,
  listBriefTasks,
  listBriefTypes,
  listBriefs,
  updateBrief,
  type Brief,
  type BriefApiClientOptions,
  type BriefStatus,
  type BriefTask,
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
  ResolvedIdentity,
  SyncContext,
} from "@/sync";
import { listProjects } from "@/campaigns";
import { resolveCampaignClient } from "@/campaigns/recipe/client";
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
 * Identity-marker pattern callers stamp into a brief's name to keep
 * re-pushes idempotent. Shape: `[story:<storyId>/<handle>]`. The orchestrator
 * uses this for story-generated briefs; ad-hoc recipes that don't carry a
 * marker fall back to exact-name match below.
 */
const IDENTITY_MARKER_RE = /\[story:[^\]]+\]\s*$/;

/**
 * Find a brief by name, paging the list endpoint until a match is
 * found or the cursor is exhausted. The Brief list endpoint supports
 * no server-side name filter, so the walk is unavoidable.
 *
 * Matching is two-stage. If the supplied `name` ends with a
 * `[story:…/…]` identity marker, we prefer to match other briefs
 * carrying the SAME marker — the marker pins identity even when an
 * operator (or the LLM) tweaks the prefix between pushes (different
 * displayName phrasing, typo fix, etc.). Falls back to exact-name
 * match when no marker is present OR when nothing matched by marker,
 * so legacy briefs without a marker still upsert cleanly.
 */
const findBriefByName = async (
  client: BriefApiClientOptions,
  name: string
): Promise<Brief | null> => {
  const markerMatch = name.match(IDENTITY_MARKER_RE);
  const marker = markerMatch ? markerMatch[0] : null;
  let cursor: string | undefined;
  let exactFallback: Brief | null = null;
  for (;;) {
    const page = await listBriefs(client, cursor ? { next: cursor } : undefined);
    for (const brief of page.data) {
      if (brief.name === name) {
        exactFallback ??= brief;
      }
      if (marker && brief.name.endsWith(marker)) {
        return brief;
      }
    }
    if (!page.next || page.data.length === 0) return exactFallback;
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

/**
 * Resolve a campaign by (storyId, campaignHandle) to its server
 * project id. Pages the Orchestrate list endpoint and returns the
 * first project carrying BOTH identity labels — `story:<storyId>`
 * and `handle:<campaignHandle>`. The orchestrator stamps these
 * labels on every story-generated campaign.
 *
 * Returns `null` when no project matches. The caller treats that as
 * "no link" — a warning is logged but the brief push still succeeds.
 */
const resolveCampaignProjectId = async (
  ctx: SyncContext,
  params: { storyId: string; campaignHandle: string }
): Promise<string | null> => {
  const storyLabel = `story:${params.storyId}`;
  const handleLabel = `handle:${params.campaignHandle}`;
  const client = await resolveCampaignClient(ctx);
  let cursor: string | undefined;
  for (;;) {
    const page = await listProjects(client, cursor ? { next: cursor } : undefined);
    for (const project of page.data) {
      const labels = project.labels ?? [];
      if (labels.includes(storyLabel) && labels.includes(handleLabel)) {
        return project.id;
      }
    }
    if (!page.next || page.data.length === 0) return null;
    cursor = page.next;
  }
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

/**
 * Canonicalise a task into a `BriefTodoSchema`-shaped object. Used both
 * to project pulled tasks into the recipe and to compare existing-vs-
 * desired todos under the full-replace apply path.
 */
const taskToTodo = (
  task: BriefTask
): { title: string; assigneeIds?: string[] } => {
  const assigneeIds = (task.assignees ?? [])
    .map((a) => a.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return {
    title: task.title,
    ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
  };
};

/** Project a live brief into the recipe shape, dropping server ids/metadata. */
const toRecipe = (
  brief: Brief,
  briefTypeName: string,
  todos: BriefTask[] | undefined
): BriefInstanceRecipe => ({
  name: brief.name,
  briefTypeName,
  locale: brief.locale || undefined,
  status: brief.status,
  isTemplate: brief.isTemplate,
  fields: brief.fields ?? {},
  ...(todos !== undefined ? { todos: todos.map(taskToTodo) } : {}),
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

  // Pull tasks (todos) so the recipe round-trips them. The brief read
  // endpoint omits `assignees` from inline tasks; list them separately
  // with `MetadataToLoad=assignees` to get the assignee subs.
  const tasks = await listBriefTasks(client, {
    briefId: brief.id,
    metadataToLoad: ["assignees"],
  });

  return toRecipe(brief, briefTypeName, tasks.data);
};

/**
 * Prefer-id read: try `getBrief(tenantId)` first when a baseline-
 * stored UUID is available. Falls back to the name-based read when
 * the id is missing or no longer resolves. Same pattern brief-types
 * + campaigns + brand-kits use — keeps re-pushes idempotent across
 * displayName edits.
 */
const readCurrentByIdOrName = async (
  ref: KindRef,
  ctx: SyncContext,
  tenantId: string | undefined
): Promise<BriefInstanceRecipe | null> => {
  if (tenantId) {
    try {
      const client = await resolveBriefClient(ctx);
      const brief = await getBrief(client, tenantId);
      if (brief) {
        const types = await listBriefTypes(client);
        const briefTypeName =
          types.data.find((t) => t.id === brief.briefType.id)?.name ?? brief.briefType.id;
        const tasks = await listBriefTasks(client, {
          briefId: brief.id,
          metadataToLoad: ["assignees"],
        });
        return toRecipe(brief, briefTypeName, tasks.data);
      }
    } catch {
      // Row deleted or transient error — fall through to name-based.
    }
  }
  return readCurrent(ref, ctx);
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

  // Prior baseline tenantId lets apply resolve the brief by id
  // before falling back to the marker-suffix-based name match.
  // Survives a displayName edit between pushes without orphaning
  // the existing tenant row.
  let priorBaselineTenantId: string | undefined;
  if (ctx.baselineStorage) {
    try {
      const prior = await ctx.baselineStorage.load<BriefBaselinePayload>(
        BRIEF_KIND_NAME,
        ctx.environmentName,
        ref.baselineKey ?? ref.id
      );
      priorBaselineTenantId = prior?.payload?.tenantId;
    } catch {
      // Best-effort.
    }
  }
  // Ref-supplied tenantId (registry-tracked) wins over the baseline-
  // stored one. Falls back when absent (CLI invocation without a
  // recipe-side id).
  const effectiveTenantId = ref.tenantId ?? priorBaselineTenantId;

  if (instanceChange.kind === "create") {
    // If the baseline has a stored tenant id, try to adopt the
    // existing row before re-creating. The plan classified this as
    // a create because readCurrent couldn't find the brief by name,
    // but the id may still resolve a renamed-but-existing row.
    let adopted: Brief | null = null;
    if (effectiveTenantId) {
      try {
        adopted = await getBrief(client, effectiveTenantId);
      } catch {
        adopted = null;
      }
    }
    const briefType = await resolveBriefType(client, recipe.briefTypeName);
    const wrappedFields = wrapBriefFields(recipe.fields, briefType);
    if (adopted) {
      ctx.logger?.info(
        `Adopting existing brief "${adopted.name}" (id ${adopted.id}) via baseline tenantId — recipe name "${recipe.name}" was a rename.`
      );
      const patch: Partial<CreateBriefInput> & { status?: BriefStatus } = {
        name: recipe.name,
        ...(recipe.locale !== undefined && { locale: recipe.locale }),
        ...(recipe.isTemplate !== undefined && { isTemplate: recipe.isTemplate }),
        ...(recipe.status !== undefined && { status: recipe.status }),
        fields: wrappedFields,
      };
      await updateBrief(client, adopted.id, patch);
      writtenBriefId = adopted.id;
      applied.push(instanceChange);
      // Skip the create+status-converge flow below.
    } else {
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
    }
  } else {
    // Prefer baseline-stored tenantId over name match — robust to
    // displayName/handle drift between pushes.
    let existing: Brief | null = null;
    if (effectiveTenantId) {
      try {
        existing = await getBrief(client, effectiveTenantId);
      } catch {
        existing = null;
      }
    }
    if (!existing) {
      existing = await findBriefByName(client, ref.id);
    }
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

  // Todos — full-replace semantics. The Brief API has no PATCH/PUT for
  // a task (verified TestDemo 2026-06-03), so converging the tenant on
  // the recipe's to-do list means delete-all-then-create-all. We avoid
  // churn by comparing canonical signatures first: if the existing
  // tasks already match the desired array (same titles + same assignee
  // sets, ignoring order), it's a no-op.
  //
  // `recipe.todos === undefined` (field omitted) leaves tenant tasks
  // untouched — back-compat with recipes that don't author todos.
  // `recipe.todos === []` explicitly clears the tenant list.
  if (writtenBriefId && recipe.todos !== undefined) {
    try {
      const existing = await listBriefTasks(client, {
        briefId: writtenBriefId,
        metadataToLoad: ["assignees"],
      });
      const existingTodos = existing.data.map(taskToTodo);
      const desiredTodos = recipe.todos.map((t) => ({
        title: t.title,
        ...(t.assigneeIds && t.assigneeIds.length > 0
          ? { assigneeIds: [...t.assigneeIds].sort() }
          : {}),
      }));
      const canonical = (
        items: Array<{ title: string; assigneeIds?: string[] }>
      ): string =>
        JSON.stringify(
          items
            .map((i) => ({
              title: i.title,
              assigneeIds: [...(i.assigneeIds ?? [])].sort(),
            }))
            .sort((a, b) => a.title.localeCompare(b.title))
        );
      if (canonical(existingTodos) === canonical(desiredTodos)) {
        ctx.logger?.info(
          `To-dos on brief "${recipe.name}" already match recipe — no changes.`
        );
      } else {
        ctx.logger?.info(
          `Replacing ${existing.data.length} to-do(s) on brief "${recipe.name}" with ${recipe.todos.length} from recipe.`
        );
        for (const task of existing.data) {
          try {
            await deleteBriefTask(client, task.id);
          } catch (err) {
            ctx.logger?.warn?.(
              `Failed to delete to-do ${task.id} on brief "${recipe.name}": ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
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
    } catch (err) {
      ctx.logger?.warn?.(
        `Failed to converge to-dos on brief "${recipe.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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

  // External references — primarily the brief→campaign link.
  // Verified writable 2026-06-03 via PUT on the brief with a
  // `references` field. Set in a follow-up PUT so the create path
  // (which doesn't accept references) stays separate from the linkage
  // step. The whole array gets replaced on each push — pull → push
  // round-trips a stable references[] field (per the read schema).
  //
  // Two sources merge: explicit `recipe.references` (operator-authored
  // pre-resolved ExternalLinks) and the resolved-at-apply-time
  // campaignHandle (the orchestrator-friendly path). Resolving the
  // handle calls the Orchestrate API to find the project carrying the
  // matching `story:<id>` + `handle:<campaign>` identity labels.
  const referencesToWrite: Array<{
    type: "ExternalLink";
    relatedSystem: string;
    relatedType?: string | null;
    id: string;
  }> = [];
  if (recipe.references && recipe.references.length > 0) {
    for (const r of recipe.references) {
      referencesToWrite.push({
        type: "ExternalLink",
        relatedSystem: r.relatedSystem,
        ...(r.relatedType !== undefined ? { relatedType: r.relatedType } : {}),
        id: r.id,
      });
    }
  }
  if (writtenBriefId && recipe.campaignHandle && recipe.storyId) {
    try {
      const projectId = await resolveCampaignProjectId(ctx, {
        storyId: recipe.storyId,
        campaignHandle: recipe.campaignHandle,
      });
      if (projectId) {
        referencesToWrite.push({
          type: "ExternalLink",
          relatedSystem: "co",
          relatedType: "Project",
          id: projectId,
        });
      } else {
        ctx.logger?.warn?.(
          `Brief "${recipe.name}" declares campaignHandle "${recipe.campaignHandle}" but no campaign with matching identity labels was found — reference not set.`
        );
      }
    } catch (err) {
      ctx.logger?.warn?.(
        `Failed to resolve campaignHandle "${recipe.campaignHandle}" for brief "${recipe.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  if (writtenBriefId && referencesToWrite.length > 0) {
    ctx.logger?.info(`Setting ${referencesToWrite.length} reference(s) on brief "${recipe.name}".`);
    try {
      await updateBrief(client, writtenBriefId, {
        references: referencesToWrite,
      });
    } catch (err) {
      ctx.logger?.warn?.(
        `Failed to set references on brief "${recipe.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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
    // Preserve the prior baseline tenantId across noop applies so a
    // future push can still resolve the row by id.
    const tenantIdForBaseline = writtenBriefId ?? effectiveTenantId ?? undefined;
    const payload = captureBriefBaselinePayload(writtenRecipe, tenantIdForBaseline);
    const baselineKey = ref.baselineKey ?? ref.id;
    const baseline: Baseline<BriefBaselinePayload> = {
      envelopeVersion: "1",
      kind: BRIEF_KIND_NAME,
      recipeHandle: baselineKey,
      envName: ctx.environmentName,
      capturedAt: new Date().toISOString(),
      payload,
    };
    try {
      await ctx.baselineStorage.write(BRIEF_KIND_NAME, ctx.environmentName, baselineKey, baseline);
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

  // Surface the resolved Sitecore Brief UUID so the caller (orchestrator
  // → registry) can persist it on the recipe and skip scai's marker-in-
  // name fallback on every subsequent push.
  const identities: ResolvedIdentity[] = [];
  if (writtenBriefId) {
    identities.push({
      scope: "brief",
      sitecoreId: writtenBriefId,
      ...(recipe.handle ? { handle: recipe.handle } : {}),
      ...(recipe.name ? { name: recipe.name } : {}),
    });
  }

  return { applied, skipped, identities };
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
  // Load baseline FIRST so we can use any stored tenant id when
  // reading current state. Survives a brief name/handle drift between
  // pushes — the id keeps pointing at the same row.
  let baselinePayload: BriefBaselinePayload | undefined;
  if (ctx.baselineStorage) {
    const loaded = await ctx.baselineStorage.load<BriefBaselinePayload>(
      BRIEF_KIND_NAME,
      ctx.environmentName,
      ref.baselineKey ?? ref.id
    );
    baselinePayload = loaded?.payload;
  }

  // Prefer the ref-supplied tenantId (registry-tracked Sitecore UUID)
  // over the baseline-stored one. The ref carries the authoritative id
  // when the caller (registry → orchestrator) knows it; baseline is a
  // fallback for CLI-only flows and first-push recovery.
  const tenantIdForLookup = ref.tenantId ?? baselinePayload?.tenantId;
  const current = await readCurrentByIdOrName(ref, ctx, tenantIdForLookup);

  // Fresh create — no baseline needed, no tenant state to merge.
  if (current === null) return diffBriefInstance(desired, null);

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
