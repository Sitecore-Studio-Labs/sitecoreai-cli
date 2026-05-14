import { Command } from "commander";
import { runAuditStaleContent } from "@/hygiene/tasks/audit-stale-content";
import { addAuditBaseOptions } from "./shared";

export const createAuditStaleContentCommand = (): Command => {
  const command = new Command("stale-content").description(
    "Find content items not updated in N days — the abandoned-content (graveyard) signal"
  );

  const list = new Command("list").description(
    "List items not updated in --not-updated-in-days, optionally excluding items currently in a workflow"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option("--not-updated-in-days <count>", "Threshold in days (default: 365)", (v) =>
    parseInt(v, 10)
  );
  list.option("--language <code>", "Restrict to one language");
  list.option(
    "--no-exclude-workflow-items",
    "Include items currently in a non-final workflow state (off by default to keep this distinct from `audit stale-workflow`)"
  );
  list.action(async (options) => {
    await runAuditStaleContent(options);
  });

  command.addCommand(list);
  return command;
};
