import { Command } from "commander";
import { runWorkflowCommands } from "@/workflow/tasks/commands";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowCommandsCommand = (): Command => {
  const command = new Command("commands")
    .description("List the workflow commands available on an item at its current state")
    .argument("<item>", "Item GUID or content-tree path (e.g. /sitecore/content/MySite/Home)")
    .action(async (item: string, options: Record<string, unknown>) => {
      await runWorkflowCommands({ ...options, item });
    });
  addWorkflowReadOptions(command);
  return command;
};
