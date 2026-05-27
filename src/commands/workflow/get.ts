import { Command } from "commander";
import { runWorkflowGet } from "@/workflow/tasks/get";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowGetCommand = (): Command => {
  const command = new Command("get")
    .description(
      "Get an item's workflow assignment — current workflow, state, and the commands available from here"
    )
    .argument(
      "<item>",
      "Workflow item GUID, content-tree path (e.g. /sitecore/system/Workflows/Sample Workflow), workflow display name (e.g. 'Sample Workflow'), or an item under workflow"
    )
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowGet({ ...options, item });
    });
  addWorkflowReadOptions(command);
  return command;
};
