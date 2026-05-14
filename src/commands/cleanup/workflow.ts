import { Command } from "commander";
import { runCleanupWorkflowAdvance } from "@/hygiene/tasks";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupWorkflowCommand = (): Command => {
  const command = new Command("workflow").description(
    "Mutating workflow operations (advance stale items, etc.)"
  );

  const advance = new Command("advance").description(
    "Execute a workflow command on items stuck past --stale-days"
  );
  addCleanupBaseOptions(advance);
  advance.requiredOption(
    "--command-name <name>",
    "Workflow command name (e.g. 'Submit', 'Approve'). Resolved case-insensitively against the item's workflow."
  );
  advance.option(
    "--stale-days <count>",
    "Days since last update for an item to be eligible (default 30)",
    (v) => parseInt(v, 10)
  );
  advance.option("--from-state <name>", "Only act on items currently in this state name");
  advance.option("--comments <text>", "Comment recorded with the workflow execution (audit trail)");
  advance.option("--root <path>", "Content root (default: /sitecore/content)");
  advance.option("--max-advances <count>", "Cap on items advanced per run (default 100)", (v) =>
    parseInt(v, 10)
  );
  advance.option("--limit <count>", "Cap on items inspected", (v) => parseInt(v, 10));
  advance.option("--index <name>", "Override the search index");
  advance.option("--include-system", "Include /sitecore/system items");
  advance.action(async (options) => {
    await runCleanupWorkflowAdvance(options);
  });
  command.addCommand(advance);
  return command;
};
