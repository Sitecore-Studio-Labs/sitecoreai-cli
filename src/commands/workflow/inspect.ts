import { Command } from "commander";
import { runWorkflowInspect } from "@/workflow/tasks/inspect";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowInspectCommand = (): Command => {
  const command = new Command("inspect")
    .description(
      "Show an item's workflow assignment — current workflow, state, and the commands available from here"
    )
    .argument(
      "<item>",
      "Workflow item GUID, content-tree path (e.g. /sitecore/system/Workflows/Sample Workflow), workflow display name (e.g. 'Sample Workflow'), or an item under workflow"
    )
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowInspect({ ...options, item });
    });
  addWorkflowReadOptions(command);
  return command;
};
