import { createScaiError } from "@/shared/errors";
import type { ItemWorkflowState, WorkflowCommandSummary } from "../api";
import {
  dashifyItemId,
  parseItemReference,
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowInspectOptions extends WorkflowTaskOptions {
  /** Item GUID or content-tree path. */
  item: string;
}

export interface WorkflowInspectResult {
  itemId: string;
  path: string | null;
  workflow: {
    workflowId: string;
    workflowName: string | null;
  };
  state: {
    stateId: string | null;
    stateName: string | null;
    final: boolean;
  };
  availableCommands: WorkflowCommandSummary[];
}

/**
 * Inspect an item's workflow assignment: current workflow, current
 * state, and the list of commands the user could execute from here.
 *
 * Returns `null` (and exits without error) if the item is not under
 * workflow. Throws `INPUT_INVALID` if the item reference is malformed.
 */
export const runWorkflowInspect = async (
  options: WorkflowInspectOptions
): Promise<WorkflowInspectResult | null> => {
  const logger = toLogger(options);
  const selector = parseItemReference(options.item);
  const { envName, client } = resolveWorkflowTenant(options);

  const wf: ItemWorkflowState | null = await client.getItemWorkflow(selector);
  if (!wf) {
    if (logger.isJson()) {
      logger.json({
        command: "workflow.inspect",
        environment: envName,
        result: null,
        reason: "item-not-found-or-not-under-workflow",
      });
    } else {
      logger.info(`No workflow on ${selector.path ?? selector.itemId ?? "(unknown)"}.`);
    }
    return null;
  }
  if (!wf.workflowId) {
    // Should be unreachable — getItemWorkflow already filters this — but
    // surface as a typed error rather than crashing on the `!` below.
    throw createScaiError(`Item ${wf.itemId} returned a workflow with no workflowId.`, "UNKNOWN");
  }

  const commands = await client.getWorkflowCommandsForItem({
    workflowId: wf.workflowId,
    itemId: dashifyItemId(wf.itemId),
  });

  const result: WorkflowInspectResult = {
    itemId: wf.itemId,
    path: wf.path,
    workflow: {
      workflowId: wf.workflowId,
      workflowName: wf.workflowName,
    },
    state: {
      stateId: wf.stateId,
      stateName: wf.stateName,
      final: wf.stateIsFinal,
    },
    availableCommands: commands,
  };

  const cmdLines =
    commands.length > 0
      ? commands.map((c) => `  - ${c.displayName} (${c.commandId})`)
      : ["  (none — terminal state or no transitions for this item)"];

  printWorkflowResult({
    logger,
    command: "workflow.inspect",
    envName,
    result,
    humanLines: [
      `Item:     ${wf.path ?? wf.itemId}`,
      `Workflow: ${wf.workflowName ?? "?"} (${wf.workflowId})`,
      `State:    ${wf.stateName ?? "?"}${wf.stateIsFinal ? " [final]" : ""}`,
      `Commands available:`,
      ...cmdLines,
    ],
  });

  return result;
};
