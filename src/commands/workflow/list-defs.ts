import { Command } from "commander";
import { runWorkflowListDefs } from "@/workflow/tasks/list-defs";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowListDefsCommand = (): Command => {
  const command = new Command("list-defs")
    .description(
      "List workflow definitions on the tenant (walks /sitecore/system/Workflows by default)"
    )
    .option(
      "--root <path>",
      "Override the workflows root path (default: /sitecore/system/Workflows)"
    )
    .action(async (options: Record<string, unknown>) => {
      await runWorkflowListDefs(options);
    });
  addWorkflowReadOptions(command);
  return command;
};
