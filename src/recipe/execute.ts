import { createScaiError } from "@/shared/errors";
import type { AuthoringApiClient, RemoteItem, RemoteFieldValue } from "./api/client";
import { renderRefValue } from "./api/ref-encoding";
import type { SitesApiClient } from "./api/sites-client";
import type { FieldValue, OperationIr } from "./ir/operations";
import {
  buildAction,
  buildPlan,
  type Plan,
  type PlanEvent,
  type PlannedAction,
  type PlanSummary,
} from "./plan";
import { rollback, type RollbackError, type RollbackEvent, type RollbackResult } from "./rollback";
import type { RollbackLogger, RollbackSummaryLog } from "./rollback-log";

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
const SITES_JOB_POLL_BUDGET_MS = 90_000;
const SITES_JOB_POLL_INTERVAL_MS = 1_000;

const awaitSitesJob = async (
  sitesClient: SitesApiClient,
  jobHandle: string,
  emit?: (event: ExecutionEvent) => void
): Promise<void> => {
  const start = Date.now();
  const deadline = start + SITES_JOB_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const job = await sitesClient.getJobStatus(jobHandle);
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
const synthesizeCreateSnapshot = (
  itemId: string,
  parentItemId: string,
  templateId: string,
  name: string,
  path: string,
  fields: readonly FieldValue[]
): RemoteItem => {
  const remoteFields: RemoteFieldValue[] = fields.map((f) => ({
    fieldId: f.fieldId,
    ...(f.fieldName !== undefined && { name: f.fieldName }),
    value: renderRefValue(f.value),
    ...(f.language !== undefined && { language: f.language }),
    ...(f.version !== undefined && { version: f.version }),
  }));
  return { itemId, parentId: parentItemId, templateId, name, path, fields: remoteFields };
};

const dispatchMutation = async (
  client: AuthoringApiClient,
  sitesClient: SitesApiClient | undefined,
  action: PlannedAction,
  capturedItemIds: Map<string, string>,
  pathItemIdCache: Map<string, string> | undefined,
  pathSnapshotCache: Map<string, RemoteItem | null> | undefined,
  emit?: (event: ExecutionEvent) => void
): Promise<void> => {
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
        synthesizeCreateSnapshot(
          result.itemId,
          action.mutation.input.parent,
          action.mutation.input.templateId,
          action.mutation.input.name,
          action.operation.path,
          action.mutation.input.fields
        )
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
  const { input, siteRefKey } = action.mutation;
  const jobResponse = await sitesClient.createSite(input);
  const jobHandle = jobResponse.handle ?? jobResponse.jobHandle;
  if (!jobHandle) {
    throw createScaiError(
      `createSite for '${input.siteName}' returned a JobResponse with no handle: ${JSON.stringify(jobResponse)}`,
      "SITES_API_FAILED"
    );
  }
  await awaitSitesJob(sitesClient, jobHandle, emit);
  // Re-list and capture the new site's itemId. The Sites API doesn't
  // return the materialised site object from createSite directly —
  // listSites is the canonical way to get the assigned id.
  const sites = await sitesClient.listSites();
  const created = sites.find((s) => s.name === input.siteName);
  if (created?.id) {
    capturedItemIds.set(siteRefKey, created.id);
  } else {
    throw createScaiError(
      `createSite for '${input.siteName}' completed but the site is not present in listSites — cannot capture itemId.`,
      "SITES_API_FAILED"
    );
  }
};

const buildResult = (
  ir: OperationIr,
  actions: PlannedAction[],
  summary: PlanSummary,
  aborted: boolean,
  rollbackResult?: RollbackResult
): ExecutionResult => ({
  plan: { schemaVersion: "1", recipeHandle: ir.recipeHandle, actions, summary },
  summary,
  aborted,
  rollback: rollbackResult,
});

const runRollback = async (
  applied: PlannedAction[],
  client: AuthoringApiClient,
  capturedItemIds: ReadonlyMap<string, string>,
  options: ExecuteOptions,
  recipeHandle: string,
  summary: { trigger: RollbackSummaryLog["trigger"]; forwardError: string }
): Promise<RollbackResult> => {
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
    });
    return { plan, summary: plan.summary, aborted: false };
  }

  const actions: PlannedAction[] = [];
  const applied: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0 };
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

  for (let index = 0; index < ir.operations.length; index += 1) {
    if (options.signal?.aborted) {
      const cancelMessage = `Cancelled by client before op ${index} of ${ir.operations.length}.`;
      const rollbackResult = await runRollback(
        applied,
        client,
        capturedItemIds,
        options,
        ir.recipeHandle,
        { trigger: "cancelled", forwardError: cancelMessage }
      );
      emitFailed(options, index, applied, rollbackResult, cancelMessage);
      return buildResult(ir, actions, summary, true, rollbackResult);
    }
    const op = ir.operations[index];
    options.emit?.({ kind: "op-start", index, operation: op });

    let action: PlannedAction;
    try {
      action = await buildAction(
        index,
        op,
        client,
        capturedItemIds,
        options.sitesClient,
        options.pathSnapshotCache
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      action = { index, operation: op, status: "error", reason: message };
      options.emit?.({ kind: "op-error", index, operation: op, error: message });
      summary.error += 1;
      actions.push(action);
      const rollbackResult = await runRollback(
        applied,
        client,
        capturedItemIds,
        options,
        ir.recipeHandle,
        { trigger: "plan-error", forwardError: message }
      );
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult(ir, actions, summary, true, rollbackResult);
    }

    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });

    if (!action.mutation) continue;

    options.emit?.({ kind: "apply-start", action });
    try {
      await dispatchMutation(
        client,
        options.sitesClient,
        action,
        capturedItemIds,
        options.pathItemIdCache,
        options.pathSnapshotCache,
        options.emit
      );
      applied.push(action);
      options.emit?.({ kind: "apply-success", action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Attach the apply-time error to the action so the top-level
      // command summary surfaces the actual server message in
      // `details[]`. The planner only sets `reason` for plan-time
      // outcomes (skip/error during plan); apply-time errors emitted
      // via `apply-error` were previously only on the event stream.
      action.status = "error";
      action.reason = message;
      options.emit?.({ kind: "apply-error", action, error: message });
      const rollbackResult = await runRollback(
        applied,
        client,
        capturedItemIds,
        options,
        ir.recipeHandle,
        { trigger: "apply-error", forwardError: message }
      );
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult(ir, actions, summary, true, rollbackResult);
    }
  }

  return buildResult(ir, actions, summary, false);
};
