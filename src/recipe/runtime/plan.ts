import type { OperationIr } from "../ir/operations";
import type { AuthoringApiClient } from "../api/client";
import type { PlannedAction, PlanSummary, Plan, PlanOptions } from "./plan-types";
import { buildSiblingCreateNames, buildFieldTargetRefKeys } from "./plan-refs";
import { buildAction } from "./build-action";

export { buildAction, type BuildActionOptions } from "./build-action";
export { buildSiblingCreateNames, buildFieldTargetRefKeys } from "./plan-refs";
export type {
  FieldDiffEntry,
  PrunedItemSnapshot,
  PlannedAction,
  PlanSummary,
  Plan,
  PlanEvent,
  PlanOptions,
} from "./plan-types";

/**
 * `scai provision recipe plan` and `scai provision recipe push` share this read-then-diff path:
 *
 *   for each op:
 *     resolve the target item (path-based for CreateItem, captured-id
 *       based for update-style ops)
 *     read remote state; diff against IR
 *     emit mutation per policy (create / update / skip / error)
 *
 * Sitecore's Authoring API server-assigns itemIds on `createItem`. The
 * IR carries deterministic uuidv5 refKeys (recipe-internal) plus
 * Sitecore paths (deterministic from recipe + envProfile roots). On each
 * push, the executor maintains a per-run `capturedItemIds: Map<refKey,
 * sitecoreItemId>` populated from `getItem(by path)` and `createItem`
 * responses. Subsequent ops resolve their target by refKey → captured
 * itemId, and `ref-recipe` field values resolve through the same map.
 */

export const buildPlan = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  options: PlanOptions = {}
): Promise<Plan> => {
  const actions: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0, prune: 0, conflict: 0 };
  const capturedItemIds = options.capturedItemIds ?? new Map<string, string>();
  // Which names this IR's creates claim under each parent — lets the
  // sibling-rename fallback avoid rebinding one create onto another's item.
  const siblingCreateNames = buildSiblingCreateNames(ir.operations);
  // Which refKeys this IR writes fields to via SetField ops — makes
  // fieldless content-item creates convergence-eligible.
  const fieldTargetRefKeys = buildFieldTargetRefKeys(ir.operations);

  for (let index = 0; index < ir.operations.length; index += 1) {
    const op = ir.operations[index];
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
        mediaFallbacks: options.mediaFallbacks,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      action = {
        index,
        operation: op,
        status: "error",
        reason: message,
      };
      options.emit?.({ kind: "op-error", index, operation: op, error: message });
    }
    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });
  }

  return {
    schemaVersion: "1",
    recipeHandle: ir.recipeHandle,
    actions,
    summary,
  };
};
