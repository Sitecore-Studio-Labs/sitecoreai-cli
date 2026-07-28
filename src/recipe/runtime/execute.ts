import type { AuthoringApiClient, RemoteItem } from "../api/client";
import type { MediaFallback } from "../api/ref-encoding";
import type { Operation, OperationIr } from "../ir/operations";
import {
  buildAction,
  buildPlan,
  buildFieldTargetRefKeys,
  buildSiblingCreateNames,
  type PlannedAction,
  type PlanSummary,
} from "./plan";
import { rollback, type RollbackResult } from "../rollback/rollback";
import type { RollbackSummaryLog } from "../rollback/rollback-log";
import type { ExecuteOptions, ExecutionResult } from "./execute-types";
import { dispatchMutation } from "./execute-dispatch";
import { errorMessage, trySkipUnavailableLanguage } from "./execute-languages";
import {
  indexAddVersionLanguages,
  isPooledMutation,
  maybeCreateWritePool,
  recordPendingWrite,
  settleForPlan,
  type PooledWrite,
} from "./execute-write-pool";

export type {
  ExecuteOptions,
  ExecutionEvent,
  ExecutionMode,
  ExecutionResult,
} from "./execute-types";
export { ensureEnvironmentLanguages, appendSiteLanguages } from "./execute-languages";

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

interface BuildResultInput {
  ir: OperationIr;
  actions: PlannedAction[];
  summary: PlanSummary;
  aborted: boolean;
  capturedItemIds: ReadonlyMap<string, string>;
  adoptedItemRefKeys?: ReadonlySet<string>;
  rollbackResult?: RollbackResult;
}

const buildResult = ({
  ir,
  actions,
  summary,
  aborted,
  capturedItemIds,
  adoptedItemRefKeys,
  rollbackResult,
}: BuildResultInput): ExecutionResult => ({
  plan: { schemaVersion: "1", recipeHandle: ir.recipeHandle, actions, summary },
  summary,
  aborted,
  rollback: rollbackResult,
  capturedItemIds,
  adoptedItemRefKeys: adoptedItemRefKeys ?? new Set<string>(),
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
  // Degrade-don't-abort is the default: standalone callers that don't
  // thread a shared map still get per-IR hotlink fallbacks for failed
  // external-URL media uploads.
  const mediaFallbacks = options.mediaFallbacks ?? new Map<string, MediaFallback>();
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
      mediaFallbacks,
    });
    return {
      plan,
      summary: plan.summary,
      aborted: false,
      capturedItemIds,
      adoptedItemRefKeys: new Set<string>(),
    };
  }

  const actions: PlannedAction[] = [];
  const applied: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0, prune: 0, conflict: 0 };
  const capturedItemIds = new Map<string, string>();
  // CreateItem refKeys whose apply adopted an existing item (no field
  // write) — see ExecutionResult.adoptedItemRefKeys.
  const adoptedItemRefKeys = new Set<string>();
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
  const pool = maybeCreateWritePool(options, {
    client,
    summary,
    applied,
    emit: options.emit,
    onError: options.onError,
  });

  // Per-IR index of which languages get version adds on each target
  // refKey — planAddItemVersion's first read of an item batches ALL of
  // them into one getItemPerLanguageBatch call instead of paying one
  // getItemVersions round trip per add op (see
  // ExecuteOptions.versionStackCache).
  const addVersionLanguagesByRef = options.versionStackCache
    ? indexAddVersionLanguages(ir)
    : new Map<string, string[]>();
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
    return buildResult({
      ir,
      actions,
      summary,
      aborted: true,
      capturedItemIds,
      adoptedItemRefKeys,
      rollbackResult,
    });
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
    return buildResult({
      ir,
      actions,
      summary,
      aborted: true,
      capturedItemIds,
      adoptedItemRefKeys,
      rollbackResult,
    });
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
        idSnapshotCache: options.idSnapshotCache,
        adoptedItemRefKeys,
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
      // Tolerant push (`onError: "continue"`): the op failed, but skip it
      // and keep going — no rollback, no abort. `dispatchMutation` threw
      // before pushing to `applied`, so there's nothing applied to undo for
      // this op; count it into `summary.error` so the per-recipe summary
      // reflects the tolerated failure, and continue the loop with
      // `aborted: false`.
      if (options.onError === "continue") {
        summary.error += 1;
        return undefined;
      }
      const rollbackResult = await runRollback({
        applied,
        client,
        capturedItemIds,
        options,
        recipeHandle: ir.recipeHandle,
        summary: { trigger: "apply-error", forwardError: message },
      });
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult({
        ir,
        actions,
        summary,
        aborted: true,
        capturedItemIds,
        adoptedItemRefKeys,
        rollbackResult,
      });
    }
  };

  // Which item names this IR's creates claim under each parent. Apply mode
  // plans each op just-in-time (so every op sees the items the previous ones
  // just created), which is exactly when the sibling-rename fallback is most
  // likely to mistake a not-yet-created sibling's item for a rename of this
  // one. Same index the plan path builds; see `findCreateItemSibling`.
  const siblingCreateNames = buildSiblingCreateNames(ir.operations);
  // RefKeys this IR writes fields to via SetField ops — makes fieldless
  // content-item creates convergence-eligible (see buildFieldTargetRefKeys).
  const fieldTargetRefKeys = buildFieldTargetRefKeys(ir.operations);

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
        siblingCreateNames,
        fieldTargetRefKeys,
        sitesClient: options.sitesClient,
        pathSnapshotCache: options.pathSnapshotCache,
        snapshotLanguages: options.snapshotLanguages,
        baselineIndex: options.baselineIndex,
        conflictPolicy: options.conflictPolicy,
        createdThisRun: options.createdItemRefKeys,
        idSnapshotCache: options.idSnapshotCache,
        versionStackCache: options.versionStackCache,
        addVersionLanguagesHint:
          op.op === "AddItemVersion" ? addVersionLanguagesByRef.get(op.itemRefKey) : undefined,
        mediaFallbacks,
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
      return buildResult({
        ir,
        actions,
        summary,
        aborted: true,
        capturedItemIds,
        adoptedItemRefKeys,
        rollbackResult,
      });
    }

    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });

    if (!action.mutation) continue;

    // Cache write-through BEFORE dispatch (pooled or sequential) so the
    // ops that follow plan against this write's outcome without a wire
    // read — see recordPendingWrite for the failure-path reasoning.
    if (isPooledMutation(action.mutation)) {
      recordPendingWrite(action.mutation, op, options);
    }

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

  return buildResult({ ir, actions, summary, aborted: false, capturedItemIds, adoptedItemRefKeys });
};
