import type { WorkflowApiClient } from "./client";

export interface ResolveWorkflowCommandOptions {
  workflowId: string;
  /** Dashified Sitecore item ID (no braces, no hyphens stripped). */
  itemId: string;
  /** Command display name; matched case-insensitively. */
  commandName: string;
}

export interface ResolveWorkflowCommandResult {
  commandId: string;
  displayName: string;
  /**
   * Number of commands whose displayName matched (case-insensitively).
   * `> 1` indicates ambiguity — callers may want to warn or fail. The
   * returned `commandId` is the first match (matches existing
   * `cleanup workflow advance` behaviour).
   */
  duplicateMatches: number;
}

/**
 * Resolve a human-friendly workflow command name (e.g. "Submit",
 * "Approve") to its `commandId` for a specific item's current state.
 *
 * Returns `null` if the workflow exposes no command with that name at
 * the item's current state.
 */
export const resolveWorkflowCommandId = async (
  client: Pick<WorkflowApiClient, "getWorkflowCommandsForItem">,
  options: ResolveWorkflowCommandOptions
): Promise<ResolveWorkflowCommandResult | null> => {
  const wanted = options.commandName.toLowerCase();
  const commands = await client.getWorkflowCommandsForItem({
    workflowId: options.workflowId,
    itemId: options.itemId,
  });
  const matches = commands.filter((c) => c.displayName.toLowerCase() === wanted);
  if (matches.length === 0) return null;
  return {
    commandId: matches[0].commandId,
    displayName: matches[0].displayName,
    duplicateMatches: matches.length,
  };
};
