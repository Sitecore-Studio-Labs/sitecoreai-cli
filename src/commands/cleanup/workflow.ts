import { Command } from "commander";
import { runCleanupWorkflowAdvance } from "@/hygiene/tasks/cleanup-workflow-advance";
import { runCleanupWorkflowApply } from "@/hygiene/tasks/cleanup-workflow-apply";
import { withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupWorkflowCommand = (): Command => {
  const command = new Command("workflow").description(
    "Mutating workflow operations (advance stale items, bulk-attach a workflow, etc.)"
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
  advance.action(withApplyGate(runCleanupWorkflowAdvance));
  command.addCommand(advance);

  const apply = new Command("apply").description(
    "Bulk-attach a workflow to items under --root (sets __Workflow + __Workflow state directly). Use to backfill content authored before the workflow existed."
  );
  addCleanupBaseOptions(apply);
  apply.requiredOption(
    "--workflow <ref>",
    "Workflow GUID, content-tree path, or display/item name (case-insensitive)"
  );
  apply.option(
    "--state <ref>",
    "Target state (GUID or name). Defaults to the workflow's __Initial state."
  );
  apply.option(
    "--template <ref>",
    "Only attach to items conforming to this template (GUID or absolute /sitecore/templates path)."
  );
  apply.option(
    "--reattach",
    "Overwrite items already attached to a different workflow. Off by default — already-attached items are skipped so the verb defaults to a safe backfill."
  );
  apply.option(
    "--stale-days <count>",
    "Only act on items not updated for at least N days. Optional — omit to attach to every match.",
    (v) => parseInt(v, 10)
  );
  apply.option("--root <path>", "Content root (default: /sitecore/content)");
  apply.option("--max-applies <count>", "Cap on items attached per run (default 100)", (v) =>
    parseInt(v, 10)
  );
  apply.option("--limit <count>", "Cap on items inspected (default 5000)", (v) => parseInt(v, 10));
  apply.option("--index <name>", "Override the search index");
  apply.option("--include-system", "Include /sitecore/system items");
  apply.action(withApplyGate(runCleanupWorkflowApply));
  command.addCommand(apply);

  return command;
};
