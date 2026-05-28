import { Command } from "commander";
import { runWorkflowDefinitions } from "@/workflow/tasks/definitions";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowDefinitionsCommand = (): Command => {
  const command = new Command("definitions")
    .description(
      "List workflow definitions on the tenant (walks /sitecore/system/Workflows by default)"
    )
    .option(
      "--root <path>",
      "Override the workflows root path (default: /sitecore/system/Workflows)"
    )
    .action(async (options: Record<string, unknown>) => {
      await runWorkflowDefinitions(options);
    });
  addWorkflowReadOptions(command);
  return command;
};
