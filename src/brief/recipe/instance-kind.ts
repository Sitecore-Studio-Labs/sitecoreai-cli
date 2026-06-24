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
  linkBriefToProject,
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
import { createScaiError, toMergeConflicts } from "@/shared/errors";
import { resolveMissingCurrentPlan } from "@/sync";
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
import { getProject, listProjects, type CampaignApiClientOptions } from "@/campaigns";
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
 * Hard ceiling on pages drained from a cursor-paged endpoint. A backstop
 * for a `next` cursor that keeps yielding fresh values forever; a healthy
 * tenant never approaches it.
 */
const MAX_LIST_PAGES = 10_000;

/**
 * Drain a cursor-paged list endpoint, calling `visit` with each page's
 * rows. `visit` returns a non-`undefined` value to short-circuit (match
 * found); returning `undefined` keeps paging.
 *
 * Stops on: end-of-stream (`next` falsy / empty page), a hard page cap,
 * or — critically — a NON-ADVANCING cursor (the endpoint returned a
 * `next` we already sent). Left unguarded, a malformed/perpetual cursor
 * makes the caller page forever; because each request individually
 * succeeds (and only carries a per-request timeout), the LOOP never
 * terminates and hangs the whole push until the orchestrator's multi-
 * minute spawn timeout kills it. This bit campaign-linked brief pushes
 * via `findProjectIdByLabels` (standalone briefs never page projects).
 * The guard degrades that infinite loop to a clean "not found" — which
 * every caller here already handles non-fatally — and invokes
 * `onNonAdvancingCursor` so the condition is observable in logs.
 */
const drainPages = async <Row, Hit>(
  fetchPage: (cursor: string | undefined) => Promise<{ data: Row[]; next: string | null }>,
  visit: (rows: Row[]) => Hit | undefined,
  onNonAdvancingCursor?: () => void
): Promise<Hit | undefined> => {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    const hit = visit(result.data);
    if (hit !== undefined) return hit;
    if (!result.next || result.data.length === 0) return undefined;
    if (seenCursors.has(result.next)) {
      onNonAdvancingCursor?.();
      return undefined;
    }
    seenCursors.add(result.next);
    cursor = result.next;
  }
  return undefined;
};

/**
 * Identity-marker pattern callers stamp into a brief's name to keep
 * re-pushes idempotent. Shape: `[story:<storyId>/<handle>]`. The orchestrator
 * uses this for story-generated briefs; ad-hoc recipes that don't carry a
 * marker fall back to exact-name match below.
 */
const IDENTITY_MARKER_RE = /\[story:[^\][]+\]\s*$/;

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
  let exactFallback: Brief | null = null;
  const markerHit = await drainPages(
    (cursor) => listBriefs(client, cursor ? { next: cursor } : undefined),
    (rows) => {
      for (const brief of rows) {
        if (brief.name === name) {
          exactFallback ??= brief;
        }
        if (marker && brief.name.endsWith(marker)) {
          return brief;
        }
      }
      return undefined;
    }
  );
  return markerHit ?? exactFallback;
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
 * Takes an already-resolved campaign client so the caller can reuse it
 * to verify the link afterwards. Returns `null` when no project matches.
 */
const findProjectIdByLabels = async (
  campaignClient: CampaignApiClientOptions,
  params: { storyId: string; campaignHandle: string },
  logger?: SyncContext["logger"]
): Promise<string | null> => {
  const storyLabel = `story:${params.storyId}`;
  const handleLabel = `handle:${params.campaignHandle}`;
  const projectId = await drainPages(
    (cursor) => listProjects(campaignClient, cursor ? { next: cursor } : undefined),
    (rows) => {
      for (const project of rows) {
        const labels = project.labels ?? [];
        if (labels.includes(storyLabel) && labels.includes(handleLabel)) {
          return project.id;
        }
      }
      return undefined;
    },
    () =>
      logger?.warn?.(
        `Orchestrate listProjects returned a non-advancing pagination cursor while resolving campaignHandle "${params.campaignHandle}" (story ${params.storyId}); stopped paging to avoid a hang. The brief->campaign link may be skipped this push — re-run after the campaign is confirmed pushed.`
      )
  );
  return projectId ?? null;
};

/** Enumerate every brief on the remote — fans out into the aggregate sync. */
const list = async (ctx: SyncContext): Promise<KindRef[]> => {
  const client = await resolveBriefClient(ctx);
  const refs: KindRef[] = [];
  await drainPages(
    (cursor) => listBriefs(client, cursor ? { next: cursor } : undefined),
    (rows) => {
      for (const brief of rows) {
        refs.push({ kind: "brief", id: brief.name });
      }
      return undefined; // never short-circuit — drain every page
    }
  );
  return refs;
};

/**
 * Canonicalise a task into a `BriefTodoSchema`-shaped object. Used both
 * to project pulled tasks into the recipe and to compare existing-vs-
 * desired todos under the full-replace apply path.
 */
const taskToTodo = (task: BriefTask): { title: string; assigneeIds?: string[] } => {
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
const stripHtmlTags = (input: string): string => {
  let prev: string;
  let out = input;
  do {
    prev = out;
    out = out.replace(/<[^<>]*>/g, "");
  } while (out !== prev);
  return out;
};

export const htmlToProseMirrorDoc = (html: string): Record<string, unknown> => {
  const plain = stripHtmlTags(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p\s*>/gi, "\n"))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
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

/**
 * Throw before any writes when the plan stamped `meta.policyError` on
 * the instance change (a `cms-edit`/`conflict` cell under the `"error"`
 * policy). No-op otherwise.
 */
const assertNoPolicyError = (instanceChange: RecipeChange, ref: KindRef): void => {
  if (instanceChange.meta?.policyError !== true) return;
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
      conflicts: toMergeConflicts(errors),
    }
  );
};

/**
 * Load the baseline-stored tenant id for a brief, best-effort. Returns
 * `undefined` with no baseline storage, no prior baseline, or a load
 * error.
 */
const loadPriorTenantId = async (
  ctx: SyncContext,
  baselineKey: string
): Promise<string | undefined> => {
  if (!ctx.baselineStorage) return undefined;
  try {
    const prior = await ctx.baselineStorage.load<BriefBaselinePayload>(
      BRIEF_KIND_NAME,
      ctx.environmentName,
      baselineKey
    );
    return prior?.payload?.tenantId;
  } catch {
    return undefined;
  }
};

/**
 * Handle the `create` branch: adopt an existing row by tenant id when
 * possible (a rename the planner saw as a create), else POST a new
 * brief and converge status. Pushes `instanceChange` to `applied` and
 * returns the written brief id.
 */
const applyCreate = async (args: {
  client: BriefApiClientOptions;
  recipe: BriefInstanceRecipe;
  effectiveTenantId: string | undefined;
  instanceChange: RecipeChange;
  applied: RecipeChange[];
  ctx: SyncContext;
}): Promise<string> => {
  const { client, recipe, effectiveTenantId, instanceChange, applied, ctx } = args;
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
    applied.push(instanceChange);
    // Skip the create+status-converge flow below.
    return adopted.id;
  }
  const input: CreateBriefInput = {
    name: recipe.name,
    briefTypeId: briefType.id,
    ...(recipe.locale !== undefined && { locale: recipe.locale }),
    ...(Object.keys(wrappedFields).length > 0 && { fields: wrappedFields }),
    ...(recipe.isTemplate !== undefined && { isTemplate: recipe.isTemplate }),
  };
  ctx.logger?.info(`Creating brief "${recipe.name}".`);
  const created = await createBrief(client, input);

  // `createBrief` accepts no `status` field — POSTs land in the
  // server default ("Draft"). If the recipe pins a different status,
  // converge with a follow-up PUT so the post-apply state matches.
  if (recipe.status && recipe.status !== created.status) {
    ctx.logger?.info(`Setting brief "${recipe.name}" status to "${recipe.status}".`);
    await updateBrief(client, created.id, { status: recipe.status });
  }
  return created.id;
};

/**
 * Handle the `update` branch: resolve the existing brief (id-first,
 * name fallback), refuse a brief-type repoint, then PUT-patch the
 * desired state. Returns the written brief id.
 */
const applyUpdate = async (
  client: BriefApiClientOptions,
  recipe: BriefInstanceRecipe,
  effectiveTenantId: string | undefined,
  ref: KindRef,
  ctx: SyncContext
): Promise<string> => {
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
  return existing.id;
};

/**
 * Converge the brief's to-do list with full-replace semantics. The
 * Brief API has no per-task PATCH (verified TestDemo 2026-06-03), so a
 * change means delete-all-then-create-all. Skips when the canonical
 * signatures already match. `recipe.todos === undefined` leaves tenant
 * tasks untouched; `[]` clears them. Self-contained — swallows + logs
 * its own errors.
 */
const convergeTodos = async (
  client: BriefApiClientOptions,
  writtenBriefId: string,
  recipe: BriefInstanceRecipe,
  ctx: SyncContext
): Promise<void> => {
  if (recipe.todos === undefined) return;
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
    const canonical = (items: Array<{ title: string; assigneeIds?: string[] }>): string =>
      JSON.stringify(
        items
          .map((i) => ({
            title: i.title,
            assigneeIds: [...(i.assigneeIds ?? [])].sort(),
          }))
          .sort((a, b) => a.title.localeCompare(b.title))
      );
    if (canonical(existingTodos) === canonical(desiredTodos)) {
      ctx.logger?.info(`To-dos on brief "${recipe.name}" already match recipe — no changes.`);
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
};

/** Post the recipe's comments to the brief. Each failure logs + continues. */
const postComments = async (
  client: BriefApiClientOptions,
  writtenBriefId: string,
  recipe: BriefInstanceRecipe,
  ctx: SyncContext
): Promise<void> => {
  if (!recipe.comments || recipe.comments.length === 0) return;
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
};

type BriefExternalReference = {
  type: "ExternalLink";
  relatedSystem: string;
  relatedType?: string | null;
  id: string;
};

/** True when the campaign's reverse view lists `briefId` under `briefs[]`. */
const campaignListsBrief = (project: { briefs?: unknown[] }, briefId: string): boolean =>
  (project.briefs ?? []).some(
    (b) => b !== null && typeof b === "object" && (b as { id?: unknown }).id === briefId
  );

/**
 * Resolve the recipe's `campaignHandle` to the Orchestrate campaign it
 * names — returning both the project id and the campaign client used to
 * find it (reused to verify the link landed). Returns null when no handle
 * is declared. A declared handle that resolves to nothing (or throws) is
 * logged as a loud `error` — it's the silent-drop that leaves the
 * campaign's reverse view empty — and yields null.
 */
const resolveCampaignTarget = async (
  recipe: BriefInstanceRecipe,
  ctx: SyncContext
): Promise<{ campaignClient: CampaignApiClientOptions; projectId: string } | null> => {
  if (!recipe.campaignHandle || !recipe.storyId) return null;
  try {
    const campaignClient = await resolveCampaignClient(ctx);
    const projectId = await findProjectIdByLabels(
      campaignClient,
      {
        storyId: recipe.storyId,
        campaignHandle: recipe.campaignHandle,
      },
      ctx.logger
    );
    if (projectId) return { campaignClient, projectId };
    ctx.logger?.error?.(
      `Brief "${recipe.name}" declares campaignHandle "${recipe.campaignHandle}" but no campaign carrying both labels story:${recipe.storyId} and handle:${recipe.campaignHandle} was found on the tenant — the brief->campaign link was NOT set. The campaign must be pushed before the brief, and must carry matching identity labels.`
    );
  } catch (err) {
    ctx.logger?.error?.(
      `Failed to resolve campaignHandle "${recipe.campaignHandle}" for brief "${recipe.name}" — the brief->campaign link was NOT set: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return null;
};

/**
 * Link the brief to its campaign via `PATCH /briefs/{id}/links` (system
 * "AI", type "project") — the action that registers the relationship with
 * Orchestrate and so populates the campaign's `project.briefs[]` reverse
 * view. Writing a `references` "co" ExternalLink (the old behaviour) stored
 * the link on the brief but never surfaced it on the campaign.
 *
 * Confirms the link by re-reading the campaign, and retries the PATCH once
 * on a silent drop. Self-contained (never throws): a brief that fails to
 * link shouldn't abort the whole push, but the failure is surfaced loudly.
 */
const linkBriefToCampaign = async (
  briefClient: BriefApiClientOptions,
  writtenBriefId: string,
  target: { campaignClient: CampaignApiClientOptions; projectId: string },
  recipe: BriefInstanceRecipe,
  ctx: SyncContext
): Promise<void> => {
  const { campaignClient, projectId } = target;
  const linked = async (): Promise<boolean> => {
    try {
      return campaignListsBrief(await getProject(campaignClient, projectId), writtenBriefId);
    } catch (err) {
      ctx.logger?.warn?.(
        `Could not re-read campaign ${projectId} to confirm the link for brief "${recipe.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return true;
    }
  };

  ctx.logger?.info(`Linking brief "${recipe.name}" to campaign ${projectId}.`);
  try {
    await linkBriefToProject(briefClient, writtenBriefId, projectId);
  } catch (err) {
    ctx.logger?.error?.(
      `Failed to link brief "${recipe.name}" to campaign ${projectId} — the brief->campaign link was NOT set: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }

  if (await linked()) return;
  ctx.logger?.warn?.(
    `Brief "${recipe.name}" -> campaign ${projectId} link did not surface on the campaign (silent drop); retrying once.`
  );
  try {
    await linkBriefToProject(briefClient, writtenBriefId, projectId);
  } catch (err) {
    ctx.logger?.error?.(
      `Retry link for brief "${recipe.name}" -> campaign ${projectId} failed — link NOT set: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }
  if (!(await linked())) {
    ctx.logger?.error?.(
      `Brief "${recipe.name}" -> campaign ${projectId} link STILL absent after retry — the campaign's reverse view will be empty. Likely an Orchestrate-side precondition (e.g. brief status) blocking the link.`
    );
  }
};

/**
 * Converge a brief's outbound links after it's written. Two independent
 * relationships, written through two different collections:
 *
 *  1. Explicit `recipe.references` — pass-through ExternalLinks the recipe
 *     declares — are replaced wholesale via `PUT /briefs/{id}` (the brief's
 *     `references` collection).
 *  2. The `campaignHandle` brief->campaign link is written via
 *     `PATCH /briefs/{id}/links` (the `links` collection), NOT `references`.
 *     This is the ONLY action Orchestrate derives the campaign's
 *     `project.briefs[]` reverse view from; a `references` "co" ExternalLink
 *     is stored on the brief but never surfaces on the campaign.
 *
 * Self-contained — a link failure logs loudly but never aborts the push.
 */
const convergeReferences = async (
  client: BriefApiClientOptions,
  writtenBriefId: string,
  recipe: BriefInstanceRecipe,
  ctx: SyncContext
): Promise<void> => {
  const referencesToWrite: BriefExternalReference[] = (recipe.references ?? []).map((r) => ({
    type: "ExternalLink",
    relatedSystem: r.relatedSystem,
    ...(r.relatedType !== undefined ? { relatedType: r.relatedType } : {}),
    id: r.id,
  }));
  if (referencesToWrite.length > 0) {
    ctx.logger?.info(`Setting ${referencesToWrite.length} reference(s) on brief "${recipe.name}".`);
    try {
      await updateBrief(client, writtenBriefId, { references: referencesToWrite });
    } catch (err) {
      ctx.logger?.error?.(
        `Failed to set references on brief "${recipe.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const target = await resolveCampaignTarget(recipe, ctx);
  if (target) {
    await linkBriefToCampaign(client, writtenBriefId, target, recipe, ctx);
  }
};

/**
 * Write the post-apply three-way baseline hash map (opt-in via
 * `ctx.baselineStorage`). Best-effort — a write failure logs and
 * degrades the next push to two-way mode rather than throwing.
 */
const captureBriefBaseline = async (
  writtenRecipe: BriefInstanceRecipe,
  writtenBriefId: string | null,
  effectiveTenantId: string | undefined,
  ref: KindRef,
  ctx: SyncContext
): Promise<void> => {
  if (!ctx.baselineStorage) return;
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
  assertNoPolicyError(instanceChange, ref);

  const recipe = instanceChange.meta?.recipe as BriefInstanceRecipe | undefined;
  if (!recipe) {
    throw createScaiError("Brief plan change is missing its recipe payload.", "INPUT_INVALID", {
      hint: "This is an internal diff error — change.meta.recipe was not set.",
    });
  }

  const writtenRecipe: BriefInstanceRecipe = recipe;

  // Prior baseline tenantId lets apply resolve the brief by id
  // before falling back to the marker-suffix-based name match.
  // Survives a displayName edit between pushes without orphaning
  // the existing tenant row.
  const priorBaselineTenantId = await loadPriorTenantId(ctx, ref.baselineKey ?? ref.id);
  // Ref-supplied tenantId (registry-tracked) wins over the baseline-
  // stored one. Falls back when absent (CLI invocation without a
  // recipe-side id).
  const effectiveTenantId = ref.tenantId ?? priorBaselineTenantId;

  const writtenBriefId: string =
    instanceChange.kind === "create"
      ? await applyCreate({ client, recipe, effectiveTenantId, instanceChange, applied, ctx })
      : await applyUpdate(client, recipe, effectiveTenantId, ref, ctx);
  applied.push(instanceChange);

  if (writtenBriefId) {
    await convergeTodos(client, writtenBriefId, recipe, ctx);
    await postComments(client, writtenBriefId, recipe, ctx);
    await convergeReferences(client, writtenBriefId, recipe, ctx);
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
  await captureBriefBaseline(writtenRecipe, writtenBriefId, effectiveTenantId, ref, ctx);

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

  // Whole-entity deletion (or fresh create) — resolved by policy via the
  // shared helper: recreate / honor-deletion / surface.
  if (current === null) {
    return resolveMissingCurrentPlan({
      kindName: BRIEF_KIND_NAME,
      ref,
      ctx,
      entityLabel: "Brief",
      recreate: () => diffBriefInstance(desired, null),
    });
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
