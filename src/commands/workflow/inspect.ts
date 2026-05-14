import { Command } from "commander";
import { runWorkflowInspect } from "@/workflow/tasks";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowInspectCommand = (): Command => {
  const command = new Command("inspect")
    .description(
      "Show an item's workflow assignment — current workflow, state, and the commands available from here"
    )
    .argument("<item>", "Item GUID or content-tree path (e.g. /sitecore/content/MySite/Home)")
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowInspect({ ...options, item });
    });
  addWorkflowReadOptions(command);
  return command;
};
