import { Command } from "commander";
import { runAuditStaleWorkflow } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditStaleWorkflowCommand = (): Command => {
  const command = new Command("stale-workflow").description(
    "Find items stuck in a workflow state past a stale-after threshold"
  );

  const list = new Command("list").description(
    "List items in a non-final workflow state with no updates in N days"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option("--days <count>", "Stale threshold in days (default: 30)", (v) => parseInt(v, 10));
  list.option("--concurrency <count>", "Per-item workflow-check concurrency", (v) =>
    parseInt(v, 10)
  );
  list.action(async (options) => {
    await runAuditStaleWorkflow(options);
  });

  command.addCommand(list);
  return command;
};
