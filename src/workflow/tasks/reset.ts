import { ensureAllowWrite } from "@/policy/allow-write";
import { createScaiError } from "@/shared/errors";
import {
  parseItemReference,
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowResetOptions extends WorkflowTaskOptions {
  /** Item GUID or content-tree path. Required. */
  item: string;
  /** Plan-only — don't issue the field write. */
  whatIf?: boolean;
  /** Per-invocation write gate override. */
  allowWrite?: boolean;
}

export type WorkflowResetStatus =
  | "reset"
  | "what-if"
  | "failed"
  | "skipped-no-workflow"
  | "skipped-already-initial";

export interface WorkflowResetResult {
  itemId: string | null;
  path: string | null;
  workflowName: string | null;
  fromState: string | null;
  toStateId: string | null;
  status: WorkflowResetStatus;
  message?: string;
}

/**
 * Force an item back to its workflow's initial state.
 *
 * **Bypasses the workflow engine.** No validation actions fire. No
 * submit actions fire. The item's `__Workflow state` field is rewritten
 * directly via `updateItem`. Workflow history is not appended.
 *
 * Use this as an admin escape hatch — recovering a stuck item that
 * the validation chain blocks, or resetting test items after a dry
 * run. For normal day-to-day transitions, use `runWorkflowAdvance`
 * which routes through `executeWorkflowCommand` and respects the
 * workflow definition.
 */
export const runWorkflowReset = async (
  options: WorkflowResetOptions
): Promise<WorkflowResetResult> => {
  const logger = toLogger(options);
  const selector = parseItemReference(options.item);
  const { envName, root, client } = resolveWorkflowTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode — no field write will happen.", "yellow");
  }

  const wf = await client.getItemWorkflow(selector);
  if (!wf || !wf.workflowId) {
    const result: WorkflowResetResult = {
      itemId: wf?.itemId ?? null,
      path: wf?.path ?? selector.path ?? null,
      workflowName: null,
      fromState: null,
      toStateId: null,
      status: "skipped-no-workflow",
      message: `Item ${selector.path ?? selector.itemId} is not under workflow; nothing to reset.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.reset",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  const initialStateId = await client.getWorkflowInitialStateId(wf.workflowId);
  if (!initialStateId) {
    throw createScaiError(
      `Workflow '${wf.workflowName ?? wf.workflowId}' has no __Initial state set; cannot reset.`,
      "UNKNOWN"
    );
  }

  // Idempotency: if the item is already at the initial state, no write.
  if (wf.stateId && wf.stateId.replace(/[{}]/g, "") === initialStateId) {
    const result: WorkflowResetResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toStateId: initialStateId,
      status: "skipped-already-initial",
      message: `Item is already at workflow '${wf.workflowName ?? "?"}' initial state '${wf.stateName ?? "?"}'.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.reset",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  if (options.whatIf) {
    const result: WorkflowResetResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toStateId: initialStateId,
      status: "what-if",
      message: `Would reset ${wf.path ?? wf.itemId} from '${wf.stateName ?? "?"}' to initial state (${initialStateId}).`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.reset",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  try {
    await client.setItemWorkflowState({
      itemId: wf.itemId,
      stateId: initialStateId,
    });
    const result: WorkflowResetResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toStateId: initialStateId,
      status: "reset",
      message: `Reset ${wf.path ?? wf.itemId} from '${wf.stateName ?? "?"}' to initial state.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.reset",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: WorkflowResetResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toStateId: null,
      status: "failed",
      message,
    };
    printWorkflowResult({
      logger,
      command: "workflow.reset",
      envName,
      result,
      humanLines: [`Failed to reset ${wf.path ?? wf.itemId}: ${message}`],
    });
    return result;
  }
};
