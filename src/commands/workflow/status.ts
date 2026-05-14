import { Command } from "commander";
import { runWorkflowStatus } from "@/workflow/tasks";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowStatusCommand = (): Command => {
  const command = new Command("status")
    .description(
      "Show per-site workflow rollup — workflows on the site, their states, and page counts per state"
    )
    .requiredOption("--site <siteId>", "Site identifier (GUID)")
    .option(
      "--content-environment-id <id>",
      "Optional Content Services environment ID (e.g. 'main')"
    )
    .action(async (options: Record<string, unknown>) => {
      await runWorkflowStatus(options as never);
    });
  addWorkflowReadOptions(command);
  return command;
};
