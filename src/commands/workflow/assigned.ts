import { Command } from "commander";
import { runWorkflowAssigned } from "@/workflow/tasks";
import { addWorkflowReadOptions } from "./shared";

export const createWorkflowAssignedCommand = (): Command => {
  const command = new Command("assigned")
    .description("Find items currently in a given workflow state (workbox-style query)")
    .requiredOption("--state <stateId>", "Workflow state GUID")
    .option(
      "--field <name>",
      "Override the search field (default: '__workflow state'; some tenants use '__workflow_state')"
    )
    .option("--index <name>", "Override the search index (default: sitecore_master_index)")
    .option("--limit <count>", "Cap on items returned (default: 500)", (v) => parseInt(v, 10))
    .option("--page-size <count>", "Search backend page size (default: 100)", (v) =>
      parseInt(v, 10)
    )
    .action(async (options: Record<string, unknown>) => {
      await runWorkflowAssigned(options as never);
    });
  addWorkflowReadOptions(command);
  return command;
};
