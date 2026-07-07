import { createScaiError } from "@/shared/errors";
import type {
  AuthoringApiClient,
  RemoteItem,
  RemoteFieldValue,
  UpdateItemInput,
} from "../api/client";
import { renderRefValue } from "../api/ref-encoding";
import type { Language, SitesApiClient } from "../api/sites-client";
import type { FieldValue, Operation, OperationIr } from "../ir/operations";
import { DEFAULT_LANGUAGE } from "../ir/sitecore-templates";
import {
  buildAction,
  buildPlan,
  type Plan,
  type PlanEvent,
  type PlannedAction,
  type PlanSummary,
} from "./plan";
import type { BaselineIndex } from "./baseline";
import {
  rollback,
  type RollbackError,
  type RollbackEvent,
  type RollbackResult,
} from "../rollback/rollback";
import type { RollbackLogger, RollbackSummaryLog } from "../rollback/rollback-log";

/**
 * `scai provision recipe push` and `scai provision recipe plan` share the same per-op
 * read-then-diff loop. Apply mode interleaves plan-and-apply: each op's
 * plan sees the cascading effect of earlier ops' applies — required for
 * idempotency.
 *
 * **Captured-itemId map.** Sitecore's Authoring API server-assigns
 * itemIds on `createItem`. The IR uses recipe-internal uuidv5 refKeys
 * for cross-references (parents, datasource template, params template,
 * insertOptions, etc.). Each push maintains a `capturedItemIds: Map<refKey,
 * sitecoreItemId>`:
 *   - Populated from `getItem(by path)` when the planner finds an
 *     existing item.
 *   - Populated from `createItem` responses when the executor creates
 *     a new item.
 *   - Read by `resolveRecipeRefs` to substitute ref-recipe values into
 *     concrete GUID strings before mutations dispatch.
 *
 * On apply error: forward execution stops and `rollback` runs over the
 * already-applied actions in LIFO order. Snapshots captured at plan time
 * drive the inverse mutations.
 */

export type ExecutionMode = "plan" | "apply";

export interface ExecutionFailedEvent {
  kind: "failed";
  failedAt: number;
  applied: number;
  rolledBack: number;
  rollbackErrors: RollbackError[];
  /** The planning or apply error that triggered the rollback. */
  error: string;
}

export type ExecutionEvent =
  | PlanEvent
  | RollbackEvent
  | { kind: "apply-start"; action: PlannedAction }
  | { kind: "apply-success"; action: PlannedAction }
  | { kind: "apply-error"; action: PlannedAction; error: string }
  /**
   * Emitted when an apply-time mutation targets a language version stack
   * for a language the environment hasn't registered, and the op is a
   * non-primary-language version write (dictionary translation or a
   * component `__Standard Values` locale-map default). Rather than abort
   * the whole push + roll back, the executor skips just that op — the
   * primary language and every registered locale still install — and
   * surfaces the skip here so operators can see what was left out and
   * why.
   */
  | { kind: "apply-skip"; action: PlannedAction; language: string; error: string }
  /**
   * Emitted on each Sites API job poll while waiting for an async op
   * (createSite, deleteSite). Lets operators and orchestrators see
   * progress on long-running jobs (cold tenants can take >30s) instead
   * of staring at a silent CLI.
   */
  | {
      kind: "site-job-poll";
      jobHandle: string;
      /** Normalized phase string read from `Job.state ?? Job.status`. */
      phase: string;
      /** Milliseconds elapsed since polling began. */
      elapsedMs: number;
    }
  | ExecutionFailedEvent;

export interface ExecutionResult {
  plan: Plan;
  summary: PlanSummary;
  /** True when push aborted before all ops were dispatched. */
  aborted: boolean;
  /** Present only when the apply phase aborted; tracks the rollback outcome. */
  rollback?: RollbackResult;
  /**
   * Per-recipe refKey → server-assigned itemId map at end of execution.
   * Populated by both plan and apply paths (plan-mode only resolves
   * what's already on the tenant). Carried out so the push task can
   * resolve `ref-recipe` field values to concrete GUIDs when writing
   * the three-way merge baseline post-apply.
   */
  capturedItemIds: ReadonlyMap<string, string>;
}

export interface ExecuteOptions {
  mode: ExecutionMode;
  emit?: (event: ExecutionEvent) => void;
  /**
   * Cooperative cancellation. When `signal.aborted` becomes true, the
   * executor stops *between* operations, runs the same rollback path
   * as a failed op, and returns an `ExecutionResult` with
   * `aborted: true` and a reason indicating client-initiated cancel.
   * In-flight requests are not interrupted — finishing the current op
   * keeps the rollback inventory accurate.
   */
  signal?: AbortSignal;
  /**
   * Cross-recipe ref pre-seed: `refKey → expectedPath` for items
   * produced by OTHER recipes in the same workspace. The executor
   * walks this map at start, calls `getItem({path})` for each entry,
   * and if found seeds `capturedItemIds` so the planner can resolve
   * `ref-recipe` / `ref-recipe-list` / `ref-source-fields` values
   * pointing at items the current recipe doesn't itself produce
   * (e.g. accordion-block's `insertOptions: ["accordion-item@1"]`).
   *
   * Entries whose path doesn't yet exist on the tenant are silently
   * skipped — those are first-push cross-recipe refs that need the
   * producer recipe to land first. Push a second time once producers
   * land, or order recipes topologically.
   */
  crossRecipeRefs?: ReadonlyMap<string, string>;
  /**
   * Sites API client — required when the IR contains
   * `CreateSiteFromTemplate` ops. Recipe sets without SiteRecipes can
   * pass undefined; site ops without a client produce an `error`
   * action at plan time and don't dispatch.
   */
  sitesClient?: SitesApiClient;
  /**
   * Workspace-wide path → itemId cache. When provided, the executor
   * threads it into the planner so `getItem({ path })` short-circuits
   * to a captured itemId when the path was already resolved (by an
   * earlier recipe's create, by `seedCrossRecipeRefs`, or by a
   * pre-execution prefetch). The same map is shared with the
   * `AuthoringApiClient`'s `pathItemIdCache` (see
   * `createAuthoringClient`) so `ensurePathExists` consults the same
   * resolutions and skips redundant tree walks.
   */
  pathItemIdCache?: Map<string, string>;
  /**
   * Workspace-wide path → RemoteItem snapshot cache. Pre-populated by
   * the workspace prefetch in `push.ts` (a single batched
   * `getItemsByPaths` call covering every CreateItem path across every
   * IR). The planner's per-op `getItem({ path })` reads consult this
   * cache first; on a hit, no wire call. `null` values mean "checked
   * and missing on the tenant" — also a cache hit, just one that
   * indicates a CreateItem is needed.
   */
  pathSnapshotCache?: Map<string, RemoteItem | null>;
  /**
   * On-disk rollback audit log. Threaded through to `rollback()` so each
   * compensating-op outcome is captured, and to `executeIr` so the
   * per-recipe summary line is written when a push aborts. Optional —
   * when absent, the executor still rolls back in-memory but writes
   * nothing to disk.
   */
  rollbackLog?: RollbackLogger;
  /**
   * Operator-level consent to delete items via `PruneChildren` ops with
   * `mode: "delete"`. Independent of the IR-level mode: the recipe
   * author flips mode on the op, and the operator flips this flag on
   * the push command. Both must align before the executor actually
   * deletes; either alone makes it a rehearsal.
   *
   * Default behavior (undefined / false): apply throws `POLICY_DENIED`
   * when it encounters a delete-mode PruneChildren — failing loudly
   * rather than silently degrading to warn. Operators set this flag via
   * the `--allow-prune` CLI option once they've reviewed the prune list
   * a previous `--what-if` run surfaced.
   */
  allowPrune?: boolean;
  /**
   * Operator override for prune-rollback snapshot languages. Forwarded
   * to the planner. When unset, the planner auto-discovers via
   * `client.getTenantLanguages` (XM Cloud Authoring's tenant-level
   * `languages { nodes { name } }` connection — `Item.languages` is
   * not in the schema). Falls back to `["en"]` if the query errors.
   * Set explicitly via `--snapshot-languages` to bound snapshot cost
   * on tenants where discovery would return languages you don't want
   * captured.
   */
  snapshotLanguages?: readonly string[];
  /**
   * Three-way merge baseline + conflict policy. Forwarded to the
   * planner so per-field drift classifies against the last-applied
   * baseline; `conflictPolicy` governs how `cms-edit` / `conflict`
   * drifts resolve. Pass `undefined` for legacy two-way-diff (the
   * default until operators opt in to baseline loading).
   */
  baselineIndex?: BaselineIndex;
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
  /**
   * Shared accumulator of item refKeys CREATED during this push run.
   * The executor adds every applied CreateItem's `op.id`; the planner
   * bypasses baseline classification for update-ops targeting these
   * (a brand-new item has no CMS edits to preserve — see
   * `BuildActionOptions.createdThisRun`). Callers pushing multiple IRs
   * (recipe push) pass ONE set across every `executeIr` call so
   * cross-IR update ops see creations from earlier IRs; defaults to a
   * per-call set for standalone use.
   */
  createdItemRefKeys?: Set<string>;
  /**
   * Apply-time concurrency for `updateItem` and `addItemVersion`
   * mutations. Default 1 — the historical strictly-sequential apply.
   * Values > 1 route those mutations through a flush pool that
   * (a) COALESCES field writes targeting the same (item, language,
   * version) cell into one `updateItem` call — a page's N per-field
   * SetFields become one POST — and (b) runs writes to DISTINCT
   * (item, language) version stacks concurrently, up to this limit;
   * localized content (dictionary translations, `__Standard Values`
   * locale maps) fans its per-locale version adds out in parallel
   * instead of one round-trip at a time. Ordering guarantees
   * preserved: writes to the same (item, language) stack stay in op
   * order, remaining mutation kinds (creates, media, prune, sites)
   * are full pool barriers, and each op's PLAN awaits just the
   * stacks it reads (`settleForPlan`) so drift diffs and version
   * reconciliation never race an in-flight write. On a pooled
   * failure the coalesced call is retried per-op sequentially to
   * isolate the failing op, which then follows the exact
   * sequential-error semantics (language-skip tolerance, else
   * rollback + abort).
   */
  applyConcurrency?: number;
}

/**
 * Wait for an async Sites API job (createSite, deleteSite, etc.) to
 * reach a terminal state. The Sites API's `getJobStatus` returns
 * a Job whose `state` field carries the lifecycle ("Initial",
 * "Running", "Done", "Failed"). Poll with linear backoff until
 * terminal or until we exceed a generous wall-clock budget.
 *
 * Site creation is typically a few seconds on warm tenants, but cold
 * tenants and content-tree-heavy SiteTemplates can take significantly
 * longer. The 90s budget covers worst-case sandbox cold-starts; in
 * production we'd surface a slow-job event so operators see progress.
 */
// 5 minutes — cold tenants (and tenants with heavy SiteTemplate Module
// composition) routinely run 1-2 minutes; verified empirically against
// TestDemo 2026-06-06 during sub-milestone E (a `createSite` job
// resolving cleanly in ~110s). The shorter 90s ceiling was timing out
// the executor on jobs the tenant was still completing.
const SITES_JOB_POLL_BUDGET_MS = 5 * 60_000;
const SITES_JOB_POLL_INTERVAL_MS = 1_000;

const awaitSitesJob = async (
  sitesClient: SitesApiClient,
  jobHandle: string,
  emit?: (event: ExecutionEvent) => void
): Promise<void> => {
  const start = Date.now();
  const deadline = start + SITES_JOB_POLL_BUDGET_MS;
  // The Sites API garbage-collects completed jobs aggressively — the
  // returned `jobHandle` from `createSite`/`deleteSite` may have
  // already lapsed by the time our first poll runs (verified
  // 2026-06-06 against TestDemo during sub-milestone E). A
  // `"X job was not found"` response on a never-observed job is
  // therefore treated the same as a `"Done"` poll: the caller's
  // subsequent `listSites` confirms the materialised site, and we
  // never saw a `Failed`/`Errored` state in between.
  while (Date.now() < deadline) {
    let job: Awaited<ReturnType<SitesApiClient["getJobStatus"]>>;
    try {
      job = await sitesClient.getJobStatus(jobHandle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/job was not found/i.test(message)) {
        emit?.({
          kind: "site-job-poll",
          jobHandle,
          phase: "Done (gc'd)",
          elapsedMs: Date.now() - start,
        });
        return;
      }
      throw error;
    }
    // Sites API deployments return either `state` (runtime) or `status`
    // (OpenAPI-spec) — accept either. See `Job` type in src/sites/api/jobs.ts.
    const phase = job.state ?? job.status ?? "";
    emit?.({ kind: "site-job-poll", jobHandle, phase, elapsedMs: Date.now() - start });
    if (phase === "Done" || phase === "Completed" || phase === "Succeeded") {
      return;
    }
    if (phase === "Failed" || phase === "Errored") {
      throw createScaiError(
        `Sites API job ${jobHandle} reported terminal state '${phase}'.`,
        "SITES_API_FAILED"
      );
    }
    await new Promise((resolve) => setTimeout(resolve, SITES_JOB_POLL_INTERVAL_MS));
  }
  throw createScaiError(
    `Sites API job ${jobHandle} did not finish within ${SITES_JOB_POLL_BUDGET_MS}ms.`,
    "SITES_API_FAILED"
  );
};

/**
 * Build a `RemoteItem` snapshot from a just-applied `createItem` so
 * subsequent reads of the same path within the push hit the cache
 * instead of querying Sitecore.
 *
 * Sitecore's Authoring API has a known read-after-write lag for
 * path-keyed lookups: `createItem` returns a 200 + assigned itemId
 * synchronously, but `getItem({ path })` for the new path can return
 * null for a few seconds while the path index propagates. Within a
 * single push, two recipes sharing a CreateOnly folder path (e.g.
 * `<enumerationsRoot>/Layout`, `<componentsRoot>/<sectionName>`) both
 * plan-then-apply against that path; without this synthetic snapshot,
 * the second recipe's planner reads stale-null, plans another create,
 * and Sitecore rejects with "name already defined on this level".
 *
 * The synthetic carries the input fields the executor just wrote, so
 * `computeFieldDrift` against it returns no drift — both CreateOnly
 * (skip) and CreateAndUpdate (also skip — same fields) yield correct
 * idempotent behavior. Real-tenant snapshots replace the synthetic on
 * the NEXT push (when the prefetch overrides it via `getItemsByPaths`).
 */
interface SynthesizeCreateSnapshotInput {
  itemId: string;
  parentItemId: string;
  templateId: string;
  name: string;
  path: string;
  fields: readonly FieldValue[];
}

const synthesizeCreateSnapshot = ({
  itemId,
  parentItemId,
  templateId,
  name,
  path,
  fields,
}: SynthesizeCreateSnapshotInput): RemoteItem => {
  const remoteFields: RemoteFieldValue[] = fields.map((f) => ({
    fieldId: f.fieldId,
    ...(f.fieldName !== undefined && { name: f.fieldName }),
    value: renderRefValue(f.value),
    ...(f.language !== undefined && { language: f.language }),
    ...(f.version !== undefined && { version: f.version }),
  }));
  return { itemId, parentId: parentItemId, templateId, name, path, fields: remoteFields };
};

/** True when an `addLanguage` error means the language is already present. */
const isAlreadyAddedLanguageError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return /\b409\b/.test(message) || /already/i.test(message);
};

/**
 * True when an apply-time error means the op's target language has no
 * registered version stack on the environment — i.e. that language isn't
 * provisioned. The Authoring API rejects a version write (AddItemVersion /
 * versioned SetField) against an unregistered language with one of these
 * shapes. Dictionary translations and component `__Standard Values`
 * locale-map defaults both emit per-language version writes, so an
 * operator whose environment lacks (say) `fr` would otherwise see the
 * whole push abort. See `nonPrimaryLanguageOfOp` for the guard that keeps
 * this scoped to non-primary-language ops only.
 */
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isUnavailableLanguageError = (message: string): boolean =>
  /does not contain version/i.test(message) ||
  /\blanguage\b[^.]*\bnot\b\s+(?:defined|found|registered|available|configured|valid|supported|installed)/i.test(
    message
  ) ||
  /\b(?:no such|unknown|invalid|unsupported)\s+language\b/i.test(message);

/**
 * If this op writes a NON-primary-language version, return that language;
 * otherwise `undefined`. Only `AddItemVersion` and a `SetField` carrying an
 * explicit non-`en` language qualify — a failure on the primary language
 * (`en`) or a language-agnostic op is always a real error and must never be
 * swallowed. Used to scope the unregistered-language skip to the ops that
 * fan a recipe's content out across locales (dictionary translations, SV
 * locale-map defaults).
 */
const nonPrimaryLanguageOfOp = (op: Operation): string | undefined => {
  if (op.op !== "AddItemVersion" && op.op !== "SetField") return undefined;
  const language = op.language;
  if (!language || language.toLowerCase() === DEFAULT_LANGUAGE) return undefined;
  return language;
};

/**
 * Apply-error handler for the unregistered-language case. When `op` writes a
 * non-primary-language version and `message` says that language isn't
 * registered on the environment, rewrite the action from its planned status
 * to `skip`, reconcile the summary, emit `apply-skip`, and return true so the
 * apply loop `continue`s instead of aborting + rolling back. Returns false for
 * any other failure, which the caller then treats as a fatal apply error.
 * Factored out of `executeIr` to keep that function under the complexity gate.
 */
const trySkipUnavailableLanguage = (
  op: Operation,
  action: PlannedAction,
  message: string,
  summary: PlanSummary,
  emit?: (event: ExecutionEvent) => void
): boolean => {
  const language = nonPrimaryLanguageOfOp(op);
  if (language === undefined || !isUnavailableLanguageError(message)) return false;
  summary[action.status] -= 1;
  action.status = "skip";
  action.reason = `Skipped: environment has no "${language}" language registered (${message}).`;
  summary.skip += 1;
  emit?.({ kind: "apply-skip", action, language, error: message });
  return true;
};

/** Regional + iso codes currently on the environment, lowercased for matching. */
const presentLanguageCodes = (languages: Language[]): Set<string> => {
  const set = new Set<string>();
  for (const lang of languages) {
    if (lang.iso) set.add(lang.iso.toLowerCase());
    if (lang.regionalIsoCode) set.add(lang.regionalIsoCode.toLowerCase());
  }
  return set;
};

/**
 * Ensure each required language exists on the environment before
 * `createSite` (which fails on an unknown `language`). Idempotent: skip
 * codes already present (single `listLanguages` pre-check), and treat the
 * Sites API's "already added" (409) as success. Adding a language here also
 * makes it available environment-wide — e.g. to the brand-kit Glossary's
 * org locales — so a recipe's `additionalLanguages` provisions brand locales
 * as a side effect.
 */
export const ensureEnvironmentLanguages = async (
  sitesClient: SitesApiClient,
  languages: string[]
): Promise<void> => {
  if (languages.length === 0) return;
  const present = presentLanguageCodes(await sitesClient.listLanguages());
  for (const code of languages) {
    if (present.has(code.toLowerCase())) continue;
    try {
      await sitesClient.addLanguage(code);
    } catch (err) {
      if (!isAlreadyAddedLanguageError(err)) throw err;
    }
  }
};

interface DispatchMutationOptions {
  client: AuthoringApiClient;
  sitesClient: SitesApiClient | undefined;
  action: PlannedAction;
  capturedItemIds: Map<string, string>;
  pathItemIdCache: Map<string, string> | undefined;
  pathSnapshotCache: Map<string, RemoteItem | null> | undefined;
  allowPrune: boolean;
  emit?: (event: ExecutionEvent) => void;
}

const dispatchMutation = async ({
  client,
  sitesClient,
  action,
  capturedItemIds,
  pathItemIdCache,
  pathSnapshotCache,
  allowPrune,
  emit,
}: DispatchMutationOptions): Promise<void> => {
  if (!action.mutation) return;
  if (action.mutation.kind === "createItem") {
    const result = await client.createItem(action.mutation.input);
    if (action.operation.op === "CreateItem") {
      capturedItemIds.set(action.operation.id, result.itemId);
      pathItemIdCache?.set(action.operation.path, result.itemId);
      // Replace the prefetch's null/stale entry with a synthetic snapshot
      // built from the input we just wrote. Subsequent reads of this
      // path within the push see "exists" via the cache, dodging
      // Sitecore's path-index propagation lag.
      pathSnapshotCache?.set(
        action.operation.path,
        synthesizeCreateSnapshot({
          itemId: result.itemId,
          parentItemId: action.mutation.input.parent,
          templateId: action.mutation.input.templateId,
          name: action.mutation.input.name,
          path: action.operation.path,
          fields: action.mutation.input.fields,
        })
      );
    }
    return;
  }
  if (action.mutation.kind === "updateItem") {
    await client.updateItem(action.mutation.input);
    return;
  }
  if (action.mutation.kind === "addItemVersion") {
    // Sitecore assigns numbered versions sequentially, so adding `addCount`
    // versions one at a time lands the item's version count at the op's
    // declared target. `addCount` is normally 1 (the compiler emits one op
    // per extra version); a larger value reconciles a gap.
    const { itemId, language, addCount } = action.mutation;
    for (let n = 0; n < addCount; n += 1) {
      await client.addItemVersion({ itemId, language });
    }
    return;
  }
  if (action.mutation.kind === "mediaUpload") {
    // Idempotency: try to read the resulting absolute path BEFORE
    // uploading; if a media item already exists at the same path, skip
    // the upload and just capture its itemId. This makes a re-push
    // a no-op once the media item exists, matching the rest of the IR
    // ops' idempotency model.
    const absolutePath = `/sitecore/media library/${action.mutation.itemPath}`;
    const existing = await client.getItem({ path: absolutePath });
    if (existing) {
      capturedItemIds.set(action.mutation.mediaRefKey, existing.itemId);
      return;
    }
    const result = await client.uploadMedia({
      itemPath: action.mutation.itemPath,
      bytes: action.mutation.bytes,
      mimeType: action.mutation.mimeType,
      ...(action.mutation.fileName !== undefined && { fileName: action.mutation.fileName }),
      ...(action.mutation.altText !== undefined && { alt: action.mutation.altText }),
      overwriteExisting: true,
    });
    capturedItemIds.set(action.mutation.mediaRefKey, result.itemId);
    return;
  }
  if (action.mutation.kind === "pruneChildren") {
    // mode "warn": the planner surfaced the prune list (action.prunedItems)
    // for the operator to review — but apply intentionally does nothing.
    // Authors flip to mode "delete" once they're confident the list is
    // what they intend.
    if (action.mutation.mode === "warn") return;
    // mode "delete" + no operator opt-in: throw rather than silently
    // skip. A silent no-op would mask the recipe author's stated intent
    // and let operators discover too late that their --apply runs
    // weren't actually pruning anything.
    if (!allowPrune) {
      throw createScaiError(
        `PruneChildren op '${action.operation.label}' has mode='delete' but the push was not invoked with --allow-prune. Re-run with --allow-prune after reviewing the prune list in --what-if.`,
        "POLICY_DENIED"
      );
    }
    for (const itemId of action.mutation.itemIds) {
      await client.deleteItem({ itemId });
    }
    // Invalidate cached snapshots for deleted items so any subsequent
    // recipe in the same push (unlikely — prunes are sorted last — but
    // possible if hand-authored ordering puts something after) sees the
    // tenant state correctly.
    if (action.prunedItems) {
      for (const pruned of action.prunedItems) {
        pathSnapshotCache?.delete(pruned.path);
        pathItemIdCache?.delete(pruned.path);
      }
    }
    return;
  }
  // createSite: dispatch through Sites API, await the async job, then
  // look up the materialised site by name to capture its itemId so
  // subsequent SetField overrides (dictionary, taxonomy) targeting
  // items under the site can resolve via late-path seeding.
  if (!sitesClient) {
    throw createScaiError(
      "createSite mutation requires a SitesApiClient — none threaded into the executor.",
      "UNKNOWN"
    );
  }
  const { input, siteRefKey, languages } = action.mutation;
  // createSite fails on a language the environment doesn't have yet — add
  // the site's primary + additional languages first (idempotent).
  await ensureEnvironmentLanguages(sitesClient, languages);
  const jobResponse = await sitesClient.createSite(input);
  const jobHandle = jobResponse.handle ?? jobResponse.jobHandle;
  if (!jobHandle) {
    throw createScaiError(
      `createSite for '${input.siteName}' returned a JobResponse with no handle: ${JSON.stringify(jobResponse)}`,
      "SITES_API_FAILED"
    );
  }
  await awaitSitesJob(sitesClient, jobHandle, emit);
  // Capture the new site's itemId by reading the SXA content-tree
  // item directly via Authoring GraphQL. The Sites API's `listSites`
  // index is eventually-consistent — verified 2026-06-06 against
  // TestDemo, the index trailed the actual site materialisation by
  // minutes despite the SXA scaffolding job reporting "Done (gc'd)".
  // Authoring GraphQL reads the same master DB the scaffolding writer
  // commits to, so the content-tree item surfaces as soon as SXA
  // writes it. SXA convention puts the site at
  // `/sitecore/content/<collectionName>/<siteName>`; when the caller
  // passed `collectionId` instead, look up the collection item by ID
  // to read its content-tree path, then append the site name.
  const siteContentPath = await resolveSiteContentPath(client, input);
  const SITE_PATH_RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 30_000];
  let createdItemId: string | undefined;
  for (const delay of SITE_PATH_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const siteItem = await client.getItem({ path: siteContentPath });
    if (siteItem?.itemId) {
      createdItemId = siteItem.itemId;
      break;
    }
  }
  if (createdItemId) {
    capturedItemIds.set(siteRefKey, createdItemId);
  } else {
    throw createScaiError(
      `createSite for '${input.siteName}' completed but the site item is not present at '${siteContentPath}' after retries — cannot capture itemId.`,
      "SITES_API_FAILED"
    );
  }
};

/**
 * Build the SXA content-tree path for a just-created site. SXA places
 * sites at `/sitecore/content/<collectionName>/<siteName>`. When the
 * caller passed `collectionId` instead of `collectionName`, fetch the
 * collection item by ID to read its content-tree path, then append the
 * site name. Throws when neither is set — the Sites API would have
 * already rejected the createSite call upstream in that case.
 */
const resolveSiteContentPath = async (
  client: AuthoringApiClient,
  input: { siteName: string; collectionName?: string | null; collectionId?: string | null }
): Promise<string> => {
  if (input.collectionName) {
    return `/sitecore/content/${input.collectionName}/${input.siteName}`;
  }
  if (input.collectionId) {
    const collection = await client.getItem({ itemId: input.collectionId });
    if (!collection?.path) {
      throw createScaiError(
        `Cannot resolve content-tree path for site '${input.siteName}' — collection '${input.collectionId}' not found.`,
        "SITES_API_FAILED"
      );
    }
    return `${collection.path.replace(/\/+$/, "")}/${input.siteName}`;
  }
  throw createScaiError(
    `Cannot resolve content-tree path for site '${input.siteName}' — neither collectionName nor collectionId set.`,
    "SITES_API_FAILED"
  );
};

/** Mutations the flush pool may carry. */
type PooledMutation =
  | { kind: "updateItem"; input: UpdateItemInput }
  | { kind: "addItemVersion"; itemId: string; language: string; addCount: number };

/** One planned pooled write (`updateItem` or `addItemVersion`) queued into the flush pool. */
interface PooledWrite {
  index: number;
  op: Operation;
  action: PlannedAction & { mutation: PooledMutation };
}

const isPooledMutation = (
  mutation: NonNullable<PlannedAction["mutation"]>
): mutation is PooledMutation =>
  mutation.kind === "updateItem" || mutation.kind === "addItemVersion";

/** (itemId, language) stack key — the pool's serialization unit. */
const stackKey = (itemId: string, language: string | undefined): string =>
  `${itemId.toLowerCase()}|${language ?? ""}`;

/**
 * Bounded-concurrency flush pool for `updateItem` and `addItemVersion`
 * mutations — the apply loop's throughput lever (see
 * `ExecuteOptions.applyConcurrency`).
 *
 * Invariants:
 *  - **Per-(item, language) serialization.** Tasks chain on the target
 *    (itemId, language) version stack, so writes to the same stack always
 *    apply in op order — while stacks of DIFFERENT languages on the same
 *    item overlap freely (Sitecore versions each language independently).
 *    This is what lets a component's 9 locale version-adds run
 *    concurrently instead of one at a time.
 *  - **Cell coalescing.** Consecutive queued-but-not-started `updateItem`
 *    entries for the same (itemId, language, version) cell merge into ONE
 *    call with their `fields` concatenated — semantically identical to N
 *    sequential single-field calls (`UpdateItemInput` carries
 *    language/version at the input level, so only same-cell entries may
 *    merge). An `addItemVersion` enqueue CLOSES its stack's pending cells
 *    so later field writes can never merge across the version boundary.
 *  - **Failure isolation.** A failed coalesced call is retried per-entry
 *    sequentially so the failing op is identified; each entry failure
 *    then follows the sequential apply-error semantics — language-skip
 *    tolerance first, otherwise the first failure is recorded as
 *    `fatal` for the main loop to turn into rollback + abort at the
 *    next drain point.
 *
 * Plan-time reads coordinate through `settle(itemId, language)`: the main
 * loop awaits just that stack's chain before planning an op that reads it,
 * instead of draining the whole pool (see `settleForPlan`).
 *
 * The pool never rejects: every task traps its own errors into `fatal`,
 * and `drain()` resolves once all in-flight work settles.
 */
class WritePool {
  private readonly limit: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly chains = new Map<string, Promise<void>>();
  /** Last VERSION-ADD task per stack — the narrower settle target for plan reads that only care about version existence (see settleAdds). */
  private readonly addChains = new Map<string, Promise<void>>();
  private readonly pendingCells = new Map<string, PooledWrite[]>();
  private readonly tasks: Promise<void>[] = [];
  fatal?: { entry: PooledWrite; message: string };

  constructor(
    limit: number,
    private readonly deps: {
      client: AuthoringApiClient;
      summary: PlanSummary;
      applied: PlannedAction[];
      emit: ExecuteOptions["emit"];
    }
  ) {
    this.limit = Math.max(1, limit);
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }

  /** Chain `run` onto a stack's task chain, bounded by the semaphore. */
  private chainTask(chainKey: string, run: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(chainKey) ?? Promise.resolve();
    const task = prev.then(async () => {
      if (this.fatal) return;
      await this.acquire();
      try {
        await run();
      } finally {
        this.release();
      }
    });
    this.chains.set(chainKey, task);
    this.tasks.push(task);
    return task;
  }

  enqueue(entry: PooledWrite): void {
    if (this.fatal) return; // push is already doomed — drain will abort
    if (entry.action.mutation.kind === "addItemVersion") {
      this.enqueueVersionAdd(entry, entry.action.mutation);
      return;
    }
    const input = entry.action.mutation.input;
    const chainKey = stackKey(input.itemId, input.language);
    const cellKey = `${chainKey}|${input.version ?? ""}`;
    const existing = this.pendingCells.get(cellKey);
    if (existing) {
      existing.push(entry);
      return;
    }
    const cell: PooledWrite[] = [entry];
    this.pendingCells.set(cellKey, cell);
    this.chainTask(chainKey, async () => {
      // Claim the cell at start — entries enqueued after this point open
      // a NEW cell chained behind this task (per-stack order preserved).
      this.pendingCells.delete(cellKey);
      await this.flushCell(cell);
    });
  }

  private enqueueVersionAdd(
    entry: PooledWrite,
    mutation: Extract<PooledMutation, { kind: "addItemVersion" }>
  ): void {
    const chainKey = stackKey(mutation.itemId, mutation.language);
    // Close this stack's pending cells: their tasks are already chained
    // BEFORE this add (correct order), but a LATER field write must never
    // merge into a pre-add cell — that would apply it before the version
    // it targets exists.
    for (const cellKey of this.pendingCells.keys()) {
      if (cellKey.startsWith(`${chainKey}|`)) this.pendingCells.delete(cellKey);
    }
    const task = this.chainTask(chainKey, async () => {
      try {
        // Sitecore assigns numbered versions sequentially — see
        // `dispatchMutation`'s addItemVersion branch, which this mirrors.
        for (let n = 0; n < mutation.addCount; n += 1) {
          await this.deps.client.addItemVersion({
            itemId: mutation.itemId,
            language: mutation.language,
          });
        }
        this.deps.applied.push(entry.action);
        this.deps.emit?.({ kind: "apply-success", action: entry.action });
      } catch (error) {
        this.recordFailure(entry, error);
      }
    });
    this.addChains.set(chainKey, task);
  }

  private async flushCell(entries: PooledWrite[]): Promise<void> {
    const inputs = entries.map(
      (e) => (e.action.mutation as Extract<PooledMutation, { kind: "updateItem" }>).input
    );
    const first = inputs[0];
    const merged: UpdateItemInput =
      inputs.length === 1
        ? first
        : {
            itemId: first.itemId,
            ...(first.language !== undefined && { language: first.language }),
            ...(first.version !== undefined && { version: first.version }),
            fields: inputs.flatMap((input) => input.fields),
          };
    try {
      await this.deps.client.updateItem(merged);
      for (const entry of entries) {
        this.deps.applied.push(entry.action);
        this.deps.emit?.({ kind: "apply-success", action: entry.action });
      }
      return;
    } catch (error) {
      if (entries.length === 1) {
        this.recordFailure(entries[0], error);
        return;
      }
    }
    // Coalesced call failed — isolate per entry, sequentially.
    for (let i = 0; i < entries.length; i += 1) {
      if (this.fatal) return;
      try {
        await this.deps.client.updateItem(inputs[i]);
        this.deps.applied.push(entries[i].action);
        this.deps.emit?.({ kind: "apply-success", action: entries[i].action });
      } catch (error) {
        this.recordFailure(entries[i], error);
      }
    }
  }

  private recordFailure(entry: PooledWrite, error: unknown): void {
    const message = errorMessage(error);
    if (
      trySkipUnavailableLanguage(entry.op, entry.action, message, this.deps.summary, this.deps.emit)
    ) {
      return;
    }
    entry.action.status = "error";
    entry.action.reason = message;
    this.deps.emit?.({ kind: "apply-error", action: entry.action, error: message });
    if (!this.fatal) this.fatal = { entry, message };
  }

  /**
   * Await ONLY the given (itemId, language) stack's in-flight writes —
   * the plan-read coordination primitive. Unlike `drain()`, other stacks
   * keep flowing, so a plan read for item A never stalls behind item B's
   * writes. Callers check `fatal` afterwards.
   */
  async settle(itemId: string, language: string | undefined): Promise<void> {
    const chain = this.chains.get(stackKey(itemId, language));
    if (chain) await chain;
  }

  /**
   * Await only the given stack's in-flight VERSION ADDS — the narrower
   * settle for plan reads that care about version existence but not
   * field values (`SetField` drift diffs, `AddItemVersion`
   * reconciliation). Plain field writes to the same stack keep flowing,
   * which is what preserves same-cell coalescing: a page's consecutive
   * SetFields would otherwise each wait for the previous one's POST.
   */
  async settleAdds(itemId: string, language: string | undefined): Promise<void> {
    const chain = this.addChains.get(stackKey(itemId, language));
    if (chain) await chain;
  }

  async drain(): Promise<void> {
    // enqueue() only runs from the (single-threaded) main loop, which is
    // awaiting us — the task list cannot grow while draining.
    await Promise.all(this.tasks);
    this.tasks.length = 0;
  }
}

/** Pool when `applyConcurrency` asks for overlap, undefined for the historical serial apply. */
const maybeCreateWritePool = (
  options: ExecuteOptions,
  deps: ConstructorParameters<typeof WritePool>[1]
): WritePool | undefined => {
  const limit = options.applyConcurrency ?? 1;
  return limit > 1 ? new WritePool(limit, deps) : undefined;
};

/**
 * Await the pool stacks whose settled state this op's PLAN reads:
 *
 *  - `SetField` / `AddItemVersion` need their target stack's VERSION
 *    ADDS applied (a versioned diff or reconciliation against a stack
 *    whose add is still in flight plans against stale state) — but NOT
 *    its field writes, which touch different fields by construction;
 *    waiting on those would serialize the very writes the pool exists
 *    to overlap (`settleAdds`).
 *  - `SetBaseTemplates` / `SetStandardValues` / `AppendToMultiList`
 *    diff/merge against SHARED field VALUES — they await the full
 *    (item, undefined-language) stack chain (`settle`).
 *
 * RefKeys that aren't captured yet have no pooled writes (pooled inputs
 * are built FROM captured ids), so they settle nothing. Ops that don't
 * read pooled state (creates, media, prunes, site ops) settle nothing —
 * their DISPATCH still global-drains via `applySequential`.
 */
const settleForPlan = async (
  pool: WritePool,
  op: Operation,
  capturedItemIds: ReadonlyMap<string, string>
): Promise<void> => {
  const settleOne = async (refKey: string, language: string | undefined, addsOnly: boolean) => {
    const itemId = capturedItemIds.get(refKey);
    if (!itemId) return;
    if (addsOnly) await pool.settleAdds(itemId, language);
    else await pool.settle(itemId, language);
  };
  if (op.op === "SetField" || op.op === "AddItemVersion") {
    await settleOne(op.itemRefKey, op.language, true);
  } else if (op.op === "SetBaseTemplates" || op.op === "AppendToMultiList") {
    await settleOne(op.itemRefKey, undefined, false);
  } else if (op.op === "SetStandardValues") {
    await settleOne(op.templateRefKey, undefined, false);
    await settleOne(op.standardValuesRefKey, undefined, false);
  }
};

interface BuildResultInput {
  ir: OperationIr;
  actions: PlannedAction[];
  summary: PlanSummary;
  aborted: boolean;
  capturedItemIds: ReadonlyMap<string, string>;
  rollbackResult?: RollbackResult;
}

const buildResult = ({
  ir,
  actions,
  summary,
  aborted,
  capturedItemIds,
  rollbackResult,
}: BuildResultInput): ExecutionResult => ({
  plan: { schemaVersion: "1", recipeHandle: ir.recipeHandle, actions, summary },
  summary,
  aborted,
  rollback: rollbackResult,
  capturedItemIds,
});

interface RunRollbackInput {
  applied: PlannedAction[];
  client: AuthoringApiClient;
  capturedItemIds: ReadonlyMap<string, string>;
  options: ExecuteOptions;
  recipeHandle: string;
  summary: { trigger: RollbackSummaryLog["trigger"]; forwardError: string };
}

const runRollback = async ({
  applied,
  client,
  capturedItemIds,
  options,
  recipeHandle,
  summary,
}: RunRollbackInput): Promise<RollbackResult> => {
  const result = await rollback(applied, client, capturedItemIds, {
    emit: options.emit,
    log: options.rollbackLog ? { logger: options.rollbackLog, recipe: recipeHandle } : undefined,
  });
  if (options.rollbackLog) {
    await options.rollbackLog.recordSummary(recipeHandle, {
      trigger: summary.trigger,
      rolledBack: result.rolledBack,
      errorCount: result.errors.length,
      forwardError: summary.forwardError,
    });
  }
  return result;
};

const emitFailed = (
  options: ExecuteOptions,
  failedAt: number,
  applied: PlannedAction[],
  rollbackResult: RollbackResult,
  error: string
): void => {
  options.emit?.({
    kind: "failed",
    failedAt,
    applied: applied.length,
    rolledBack: rollbackResult.rolledBack,
    rollbackErrors: rollbackResult.errors,
    error,
  });
};

/**
 * Look up each cross-recipe ref's expected path on the tenant; capture
 * any that exist. Skips refs the current IR produces (those land via
 * dispatchMutation as the current recipe applies). Best-effort: a
 * missing item is fine — that ref won't resolve, the dependent op will
 * skip with a clear "refKey ... not in captured map" error.
 *
 * When a `pathSnapshotCache` is provided (workspace prefetch already
 * ran), this short-circuits to in-memory lookups for every ref whose
 * path is already cached — zero wire calls. Refs not yet cached fall
 * through to a single batched `getItemsByPaths` round trip rather than
 * the per-ref sequential `getItem` loop the original implementation
 * used.
 */
const seedCrossRecipeRefs = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  refs: ReadonlyMap<string, string>,
  capturedItemIds: Map<string, string>,
  pathSnapshotCache?: Map<string, RemoteItem | null>
): Promise<void> => {
  const ownRefs = new Set<string>();
  for (const op of ir.operations) {
    if (op.op === "CreateItem") ownRefs.add(op.id);
  }

  const pathsToFetch: string[] = [];
  const refByPath = new Map<string, string[]>();

  for (const [refKey, expectedPath] of refs) {
    if (ownRefs.has(refKey)) continue;
    if (capturedItemIds.has(refKey)) continue;

    // Cache hit on a previous prefetch / sibling-recipe seed — resolve
    // without a wire call.
    const snapshot = pathSnapshotCache?.get(expectedPath);
    if (snapshot !== undefined) {
      if (snapshot) capturedItemIds.set(refKey, snapshot.itemId);
      continue;
    }

    pathsToFetch.push(expectedPath);
    const bucket = refByPath.get(expectedPath);
    if (bucket) bucket.push(refKey);
    else refByPath.set(expectedPath, [refKey]);
  }

  if (pathsToFetch.length === 0) return;

  const fetched = await client.getItemsByPaths(pathsToFetch);
  for (const [path, item] of fetched) {
    pathSnapshotCache?.set(path, item);
    if (!item) continue;
    const refKeys = refByPath.get(path) ?? [];
    for (const refKey of refKeys) {
      capturedItemIds.set(refKey, item.itemId);
    }
  }
};

export const executeIr = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  options: ExecuteOptions
): Promise<ExecutionResult> => {
  if (options.mode === "plan") {
    const capturedItemIds = new Map<string, string>();
    // Pre-seed path-keyed entries from the workspace path-itemId cache
    // (populated by the workspace prefetch in push.ts). The planner's
    // ref-path parent resolution checks `capturedItemIds.get(path)` —
    // a hit avoids the per-op `getItem({ path: parent })` round trip.
    if (options.pathItemIdCache) {
      for (const [path, itemId] of options.pathItemIdCache) {
        if (!capturedItemIds.has(path)) capturedItemIds.set(path, itemId);
      }
    }
    if (options.crossRecipeRefs) {
      await seedCrossRecipeRefs(
        ir,
        client,
        options.crossRecipeRefs,
        capturedItemIds,
        options.pathSnapshotCache
      );
    }
    const plan = await buildPlan(ir, client, {
      emit: options.emit,
      capturedItemIds,
      sitesClient: options.sitesClient,
      pathItemIdCache: options.pathItemIdCache,
      pathSnapshotCache: options.pathSnapshotCache,
      // Forward the operator's snapshot-languages override so
      // `recipe push --what-if` reports the same prune-rollback
      // snapshot intent that the apply pass would use. Without this,
      // plan-mode silently auto-discovered while apply honored the
      // operator's --snapshot-languages list — the audit trail diverged.
      snapshotLanguages: options.snapshotLanguages,
      // Three-way merge — the planner classifies drift against the
      // baseline (when one is loaded) and applies conflictPolicy to
      // each drift action's resolved status. Forwarded from the
      // execute caller so plan-mode preview shows the same conflict
      // surface apply would gate on.
      baselineIndex: options.baselineIndex,
      conflictPolicy: options.conflictPolicy,
    });
    return { plan, summary: plan.summary, aborted: false, capturedItemIds };
  }

  const actions: PlannedAction[] = [];
  const applied: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0, prune: 0, conflict: 0 };
  const capturedItemIds = new Map<string, string>();
  if (options.pathItemIdCache) {
    for (const [path, itemId] of options.pathItemIdCache) {
      if (!capturedItemIds.has(path)) capturedItemIds.set(path, itemId);
    }
  }
  if (options.crossRecipeRefs) {
    await seedCrossRecipeRefs(
      ir,
      client,
      options.crossRecipeRefs,
      capturedItemIds,
      options.pathSnapshotCache
    );
  }

  // Optional updateItem flush pool — see ExecuteOptions.applyConcurrency.
  const pool = maybeCreateWritePool(options, { client, summary, applied, emit: options.emit });
  /**
   * Drain the pool and, if a pooled apply failed fatally, return the
   * abort result via the exact sequential apply-error semantics
   * (rollback of everything applied, aborted ExecutionResult).
   */
  const drainPool = async (): Promise<ExecutionResult | undefined> => {
    if (!pool) return undefined;
    await pool.drain();
    const fatal = pool.fatal;
    if (!fatal) return undefined;
    const rollbackResult = await runRollback({
      applied,
      client,
      capturedItemIds,
      options,
      recipeHandle: ir.recipeHandle,
      summary: { trigger: "apply-error", forwardError: fatal.message },
    });
    emitFailed(options, fatal.entry.index, applied, rollbackResult, fatal.message);
    return buildResult({ ir, actions, summary, aborted: true, capturedItemIds, rollbackResult });
  };

  /**
   * Client cancellation. Lets in-flight pooled writes settle first so the
   * rollback covers them; a pooled fatal takes precedence over the
   * cancellation.
   */
  const abortForCancellation = async (index: number): Promise<ExecutionResult> => {
    const poolAbort = await drainPool();
    if (poolAbort) return poolAbort;
    const cancelMessage = `Cancelled by client before op ${index} of ${ir.operations.length}.`;
    const rollbackResult = await runRollback({
      applied,
      client,
      capturedItemIds,
      options,
      recipeHandle: ir.recipeHandle,
      summary: { trigger: "cancelled", forwardError: cancelMessage },
    });
    emitFailed(options, index, applied, rollbackResult, cancelMessage);
    return buildResult({ ir, actions, summary, aborted: true, capturedItemIds, rollbackResult });
  };

  /**
   * Sequential dispatch for every non-updateItem mutation. Drains the pool
   * first — creates capture ids later ops resolve, version adds change the
   * stacks versioned writes target, prunes delete what pooled writes may
   * touch — then applies with the historical error handling. Returns the
   * aborted ExecutionResult on failure, undefined to continue the loop.
   */
  const applySequential = async (
    index: number,
    op: Operation,
    action: PlannedAction
  ): Promise<ExecutionResult | undefined> => {
    const poolAbort = await drainPool();
    if (poolAbort) return poolAbort;
    options.emit?.({ kind: "apply-start", action });
    try {
      await dispatchMutation({
        client,
        sitesClient: options.sitesClient,
        action,
        capturedItemIds,
        pathItemIdCache: options.pathItemIdCache,
        pathSnapshotCache: options.pathSnapshotCache,
        allowPrune: options.allowPrune ?? false,
        emit: options.emit,
      });
      applied.push(action);
      // Record fresh creations so later update-ops (this IR or a
      // sibling IR sharing options.createdItemRefKeys) bypass baseline
      // classification for them — see ExecuteOptions.createdItemRefKeys.
      if (op.op === "CreateItem" && action.status === "create") {
        options.createdItemRefKeys?.add(op.id);
      }
      options.emit?.({ kind: "apply-success", action });
      return undefined;
    } catch (error) {
      const message = errorMessage(error);
      // Unregistered-language tolerance. A recipe may fan content out
      // across locales (dictionary translations, `__Standard Values`
      // locale-map defaults) into languages the target environment hasn't
      // provisioned. The Authoring API rejects the version write for a
      // missing language; `trySkipUnavailableLanguage` turns that single
      // op into a SKIP and returns undefined so the loop keeps going — the
      // primary language and every registered locale still install instead
      // of the whole push aborting + rolling back. Scoped to
      // non-primary-language version writes so a genuine `en` failure
      // still aborts. `applied` is untouched here (dispatchMutation threw
      // before recording), so there's nothing to roll back for this op.
      if (trySkipUnavailableLanguage(op, action, message, summary, options.emit)) {
        return undefined;
      }
      // Attach the apply-time error to the action so the top-level
      // command summary surfaces the actual server message in
      // `details[]`. The planner only sets `reason` for plan-time
      // outcomes (skip/error during plan); apply-time errors emitted
      // via `apply-error` were previously only on the event stream.
      action.status = "error";
      action.reason = message;
      options.emit?.({ kind: "apply-error", action, error: message });
      const rollbackResult = await runRollback({
        applied,
        client,
        capturedItemIds,
        options,
        recipeHandle: ir.recipeHandle,
        summary: { trigger: "apply-error", forwardError: message },
      });
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult({ ir, actions, summary, aborted: true, capturedItemIds, rollbackResult });
    }
  };

  for (let index = 0; index < ir.operations.length; index += 1) {
    if (options.signal?.aborted) {
      return abortForCancellation(index);
    }
    const op = ir.operations[index];
    // Plan reads must see settled state for the stacks they inspect —
    // await ONLY those stacks (other items' writes keep flowing). A
    // pooled fatal discovered here aborts with the usual semantics.
    if (pool) {
      await settleForPlan(pool, op, capturedItemIds);
      if (pool.fatal) {
        const poolAbort = await drainPool();
        if (poolAbort) return poolAbort;
      }
    }
    options.emit?.({ kind: "op-start", index, operation: op });

    let action: PlannedAction;
    try {
      action = await buildAction({
        index,
        op,
        client,
        capturedItemIds,
        sitesClient: options.sitesClient,
        pathSnapshotCache: options.pathSnapshotCache,
        snapshotLanguages: options.snapshotLanguages,
        baselineIndex: options.baselineIndex,
        conflictPolicy: options.conflictPolicy,
        createdThisRun: options.createdItemRefKeys,
      });
    } catch (error) {
      const message = errorMessage(error);
      action = { index, operation: op, status: "error", reason: message };
      options.emit?.({ kind: "op-error", index, operation: op, error: message });
      summary.error += 1;
      actions.push(action);
      const rollbackResult = await runRollback({
        applied,
        client,
        capturedItemIds,
        options,
        recipeHandle: ir.recipeHandle,
        summary: { trigger: "plan-error", forwardError: message },
      });
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult({ ir, actions, summary, aborted: true, capturedItemIds, rollbackResult });
    }

    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });

    if (!action.mutation) continue;

    if (pool && isPooledMutation(action.mutation)) {
      // Route through the flush pool: field writes coalesce per cell,
      // version adds chain per (item, language) stack, everything runs
      // concurrently across stacks. Failures surface at the next
      // settle/drain point with sequential-identical semantics.
      options.emit?.({ kind: "apply-start", action });
      pool.enqueue({ index, op, action } as PooledWrite);
      continue;
    }
    // Every remaining mutation kind (create, site, media, prune) is a
    // pool barrier — applySequential drains before dispatching.
    const abort = await applySequential(index, op, action);
    if (abort) return abort;
  }

  {
    const poolAbort = await drainPool();
    if (poolAbort) return poolAbort;
  }

  return buildResult({ ir, actions, summary, aborted: false, capturedItemIds });
};
