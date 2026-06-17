import { ensureAllowWrite } from "@/policy/allow-write";
import { createScaiError } from "@/shared/errors";
import {
  parseItemReference,
  printWorkflowResult,
  resolveWorkflowRef,
  resolveWorkflowState,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowApplyOptions extends WorkflowTaskOptions {
  /** Item GUID or content-tree path to attach the workflow to. Required. */
  item: string;
  /**
   * Workflow GUID, content-tree path, or display/item name. Required.
   * Same resolution as `runWorkflowGet`: GUID → direct, path →
   * lookup, free text → name match against `listWorkflowDefinitions`.
   */
  workflow: string;
  /**
   * Override the state to land on. Defaults to the workflow's
   * `__Initial state`. Pass either a state GUID or a state name (e.g.
   * "Draft") to start the item somewhere other than initial.
   */
  state?: string;
  /** Plan-only — don't issue the field write. */
  whatIf?: boolean;
  /** Per-invocation write gate override. */
  allowWrite?: boolean;
}

export type WorkflowApplyStatus =
  | "applied"
  | "what-if"
  | "failed"
  | "skipped-already-attached"
  | "skipped-workflow-not-found"
  | "skipped-state-not-found";

export interface WorkflowApplyResult {
  itemId: string | null;
  path: string | null;
  workflowItemId: string | null;
  workflowName: string | null;
  stateItemId: string | null;
  stateName: string | null;
  status: WorkflowApplyStatus;
  message?: string;
}

/**
 * Attach a workflow to an item — sets the item's `__Workflow` and
 * `__Workflow state` fields directly via `updateItem`. Bypasses the
 * workflow engine; no submit/validation actions fire.
 *
 * Useful when content was authored before the workflow existed, or
 * when an item was orphaned by a workflow rename. For new items
 * created via recipe / CMS UX, attach the workflow via Standard
 * Values (`__Default workflow` field) on the template instead.
 *
 * The `workflow` ref accepts any of: workflow GUID, content-tree path,
 * or display/item name (resolved against `listWorkflowDefinitions`).
 * Same resolver as `workflow_inspect verb=get`.
 */
export const runWorkflowApply = async (
  options: WorkflowApplyOptions
): Promise<WorkflowApplyResult> => {
  const logger = toLogger(options);
  if (!options.workflow) {
    throw createScaiError("--workflow is required.", "INPUT_INVALID");
  }
  const itemSelector = parseItemReference(options.item);
  const { envName, root, client } = resolveWorkflowTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode — no field write will happen.", "yellow");
  }

  // Resolve workflow ref → workflow definition detail.
  const wfRef = options.workflow.trim();
  const workflowDetail = await resolveWorkflowRef(client, wfRef);
  if (!workflowDetail) {
    const result: WorkflowApplyResult = {
      itemId: null,
      path: itemSelector.path ?? null,
      workflowItemId: null,
      workflowName: null,
      stateItemId: null,
      stateName: null,
      status: "skipped-workflow-not-found",
      message: `Workflow '${wfRef}' did not resolve to a Workflow-templated item.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.apply",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  // Resolve target state. Default to initial state.
  let targetStateId: string;
  let targetStateName: string | null;
  if (options.state) {
    const stateRef = options.state.trim();
    const match = resolveWorkflowState(workflowDetail, stateRef);
    if (!match) {
      const result: WorkflowApplyResult = {
        itemId: null,
        path: itemSelector.path ?? null,
        workflowItemId: workflowDetail.itemId,
        workflowName: workflowDetail.displayName ?? workflowDetail.name,
        stateItemId: null,
        stateName: null,
        status: "skipped-state-not-found",
        message: `Workflow '${workflowDetail.displayName ?? workflowDetail.name}' has no state named or matching '${stateRef}'.`,
      };
      printWorkflowResult({
        logger,
        command: "workflow.apply",
        envName,
        result,
        humanLines: [result.message ?? ""],
      });
      return result;
    }
    targetStateId = match.itemId;
    targetStateName = match.name;
  } else {
    const initialStateId = await client.getWorkflowInitialStateId(workflowDetail.itemId);
    if (!initialStateId) {
      throw createScaiError(
        `Workflow '${workflowDetail.displayName ?? workflowDetail.name}' has no __Initial state set.`,
        "UNKNOWN"
      );
    }
    targetStateId = initialStateId;
    const initial = workflowDetail.states.find(
      (s) =>
        s.itemId.replace(/[{}]/g, "").toLowerCase() ===
        initialStateId.replace(/[{}]/g, "").toLowerCase()
    );
    targetStateName = initial?.displayName ?? initial?.name ?? null;
  }

  // Idempotency: item already attached to this workflow + state.
  const existingWf = await client.getItemWorkflow(itemSelector);
  if (
    existingWf &&
    existingWf.workflowId &&
    existingWf.workflowId.replace(/[{}]/g, "").toLowerCase() ===
      workflowDetail.itemId.replace(/[{}]/g, "").toLowerCase() &&
    existingWf.stateId &&
    existingWf.stateId.replace(/[{}]/g, "").toLowerCase() ===
      targetStateId.replace(/[{}]/g, "").toLowerCase()
  ) {
    const result: WorkflowApplyResult = {
      itemId: existingWf.itemId,
      path: existingWf.path,
      workflowItemId: workflowDetail.itemId,
      workflowName: workflowDetail.displayName ?? workflowDetail.name,
      stateItemId: targetStateId,
      stateName: targetStateName,
      status: "skipped-already-attached",
      message: `Item already attached to workflow '${workflowDetail.displayName ?? workflowDetail.name}' at state '${targetStateName ?? "?"}'.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.apply",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  if (options.whatIf) {
    const result: WorkflowApplyResult = {
      itemId: existingWf?.itemId ?? null,
      path: existingWf?.path ?? itemSelector.path ?? null,
      workflowItemId: workflowDetail.itemId,
      workflowName: workflowDetail.displayName ?? workflowDetail.name,
      stateItemId: targetStateId,
      stateName: targetStateName,
      status: "what-if",
      message: `Would attach ${itemSelector.path ?? itemSelector.itemId} to workflow '${workflowDetail.displayName ?? workflowDetail.name}' at state '${targetStateName ?? "?"}'.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.apply",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  try {
    await client.setItemWorkflowState({
      ...(itemSelector.itemId ? { itemId: itemSelector.itemId } : { path: itemSelector.path }),
      workflowId: workflowDetail.itemId,
      stateId: targetStateId,
    });
    const result: WorkflowApplyResult = {
      itemId: existingWf?.itemId ?? itemSelector.itemId ?? null,
      path: existingWf?.path ?? itemSelector.path ?? null,
      workflowItemId: workflowDetail.itemId,
      workflowName: workflowDetail.displayName ?? workflowDetail.name,
      stateItemId: targetStateId,
      stateName: targetStateName,
      status: "applied",
      message: `Attached ${itemSelector.path ?? itemSelector.itemId} to workflow '${workflowDetail.displayName ?? workflowDetail.name}' at state '${targetStateName ?? "?"}'.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.apply",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: WorkflowApplyResult = {
      itemId: existingWf?.itemId ?? itemSelector.itemId ?? null,
      path: existingWf?.path ?? itemSelector.path ?? null,
      workflowItemId: workflowDetail.itemId,
      workflowName: workflowDetail.displayName ?? workflowDetail.name,
      stateItemId: null,
      stateName: null,
      status: "failed",
      message,
    };
    printWorkflowResult({
      logger,
      command: "workflow.apply",
      envName,
      result,
      humanLines: [`Failed to apply workflow: ${message}`],
    });
    return result;
  }
};
