import type { WorkflowCommandSummary } from "../api";
import {
  parseItemReference,
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowListCommandsOptions extends WorkflowTaskOptions {
  /** Item GUID or content-tree path. */
  item: string;
}

export interface WorkflowListCommandsResult {
  itemId: string;
  path: string | null;
  workflowId: string;
  commands: WorkflowCommandSummary[];
}

const dashifyItemId = (id: string): string => {
  const hex = id.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * List the workflow commands available on an item at its current state.
 * Returns `null` if the item is not under workflow.
 *
 * Lighter-weight counterpart to `runWorkflowInspect` for callers that
 * only want the transitions — e.g. wiring an `advance` flow with a
 * fuzzy-pick UI.
 */
export const runWorkflowListCommands = async (
  options: WorkflowListCommandsOptions
): Promise<WorkflowListCommandsResult | null> => {
  const logger = toLogger(options);
  const selector = parseItemReference(options.item);
  const { envName, client } = resolveWorkflowTenant(options);

  const wf = await client.getItemWorkflow(selector);
  if (!wf || !wf.workflowId) {
    if (logger.isJson()) {
      logger.json({
        command: "workflow.list-commands",
        environment: envName,
        result: null,
        reason: "item-not-found-or-not-under-workflow",
      });
    } else {
      logger.info(`No workflow on ${selector.path ?? selector.itemId ?? "(unknown)"}.`);
    }
    return null;
  }

  const commands = await client.getWorkflowCommandsForItem({
    workflowId: wf.workflowId,
    itemId: dashifyItemId(wf.itemId),
  });

  const result: WorkflowListCommandsResult = {
    itemId: wf.itemId,
    path: wf.path,
    workflowId: wf.workflowId,
    commands,
  };

  const lines =
    commands.length > 0
      ? commands.map((c) => `${c.displayName} (${c.commandId})`)
      : ["(no commands available — terminal state or no transitions for this item)"];

  printWorkflowResult({
    logger,
    command: "workflow.list-commands",
    envName,
    result,
    humanLines: lines,
  });

  return result;
};
