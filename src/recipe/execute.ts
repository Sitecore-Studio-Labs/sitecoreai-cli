import type { AuthoringApiClient } from "./api/client";
import type { OperationIr } from "./ir/operations";
import {
  buildAction,
  buildPlan,
  type Plan,
  type PlanEvent,
  type PlannedAction,
  type PlanSummary,
} from "./plan";
import { rollback, type RollbackError, type RollbackEvent, type RollbackResult } from "./rollback";

/**
 * `scai recipe push` and `scai recipe plan` share the same per-op
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
   * Cross-recipe ref pre-seed: `refKey → expectedPath` for items
   * produced by OTHER recipes in the same workspace. The executor
   * walks this map at start, calls `getItem({path})` for each entry,
   * and if found seeds `capturedItemIds` so the planner can resolve
   * `ref-recipe` / `ref-recipe-list` / `ref-source-prefix` values
   * pointing at items the current recipe doesn't itself produce
   * (e.g. accordion-block's `insertOptions: ["accordion-item@1"]`).
   *
   * Entries whose path doesn't yet exist on the tenant are silently
   * skipped — those are first-push cross-recipe refs that need the
   * producer recipe to land first. Push a second time once producers
   * land, or order recipes topologically.
   */
  crossRecipeRefs?: ReadonlyMap<string, string>;
}

const dispatchMutation = async (
  client: AuthoringApiClient,
  action: PlannedAction,
  capturedItemIds: Map<string, string>
): Promise<void> => {
  if (!action.mutation) return;
  if (action.mutation.kind === "createItem") {
    const result = await client.createItem(action.mutation.input);
    // Capture the assigned itemId so subsequent ops can resolve refs.
    if (action.operation.op === "CreateItem") {
      capturedItemIds.set(action.operation.id, result.itemId);
    }
  } else {
    await client.updateItem(action.mutation.input);
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
  options: ExecuteOptions
): Promise<RollbackResult> => rollback(applied, client, capturedItemIds, { emit: options.emit });

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
 */
const seedCrossRecipeRefs = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  refs: ReadonlyMap<string, string>,
  capturedItemIds: Map<string, string>
): Promise<void> => {
  const ownRefs = new Set<string>();
  for (const op of ir.operations) {
    if (op.op === "CreateItem") ownRefs.add(op.id);
  }
  for (const [refKey, expectedPath] of refs) {
    if (ownRefs.has(refKey)) continue;
    if (capturedItemIds.has(refKey)) continue;
    const remote = await client.getItem({ path: expectedPath });
    if (remote) capturedItemIds.set(refKey, remote.itemId);
  }
};

export const executeIr = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  options: ExecuteOptions
): Promise<ExecutionResult> => {
  if (options.mode === "plan") {
    const capturedItemIds = new Map<string, string>();
    if (options.crossRecipeRefs) {
      await seedCrossRecipeRefs(ir, client, options.crossRecipeRefs, capturedItemIds);
    }
    const plan = await buildPlan(ir, client, {
      emit: options.emit,
      capturedItemIds,
    });
    return { plan, summary: plan.summary, aborted: false };
  }

  const actions: PlannedAction[] = [];
  const applied: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0 };
  const capturedItemIds = new Map<string, string>();
  if (options.crossRecipeRefs) {
    await seedCrossRecipeRefs(ir, client, options.crossRecipeRefs, capturedItemIds);
  }

  for (let index = 0; index < ir.operations.length; index += 1) {
    const op = ir.operations[index];
    options.emit?.({ kind: "op-start", index, operation: op });

    let action: PlannedAction;
    try {
      action = await buildAction(index, op, client, capturedItemIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      action = { index, operation: op, status: "error", reason: message };
      options.emit?.({ kind: "op-error", index, operation: op, error: message });
      summary.error += 1;
      actions.push(action);
      const rollbackResult = await runRollback(applied, client, capturedItemIds, options);
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult(ir, actions, summary, true, rollbackResult);
    }

    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });

    if (!action.mutation) continue;

    options.emit?.({ kind: "apply-start", action });
    try {
      await dispatchMutation(client, action, capturedItemIds);
      applied.push(action);
      options.emit?.({ kind: "apply-success", action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.emit?.({ kind: "apply-error", action, error: message });
      const rollbackResult = await runRollback(applied, client, capturedItemIds, options);
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult(ir, actions, summary, true, rollbackResult);
    }
  }

  return buildResult(ir, actions, summary, false);
};
