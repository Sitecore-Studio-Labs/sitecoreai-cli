import { Command } from "commander";
import { runWorkflowListCommands } from "@/workflow/tasks/list-commands";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowListCommandsCommand = (): Command => {
  const command = new Command("list-commands")
    .description("List the workflow commands available on an item at its current state")
    .argument("<item>", "Item GUID or content-tree path (e.g. /sitecore/content/MySite/Home)")
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowListCommands({ ...options, item });
    });
  addWorkflowReadOptions(command);
  return command;
};
