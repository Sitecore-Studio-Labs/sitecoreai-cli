import { Command } from "commander";
import { runCleanupDeadTemplates } from "@/hygiene/tasks/cleanup-dead-templates";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupDeadTemplatesCommand = (): Command => {
  const command = new Command("dead-templates").description(
    "Delete templates that have zero items derived from them"
  );

  const purge = new Command("purge").description(
    "Delete dead templates, optionally cleaning up empty template folders left behind"
  );
  addCleanupBaseOptions(purge);
  purge.option("--root <path>", "Template-tree root (default: /sitecore/templates/Project)");
  purge.option("--limit <count>", "Cap on templates inspected (default: 5000)", (v) =>
    parseInt(v, 10)
  );
  purge.option("--concurrency <count>", "Delete concurrency (default: 4)", (v) => parseInt(v, 10));
  purge.option(
    "--no-cleanup-empty-folders",
    "Skip the recursive empty-folder cleanup after templates are deleted (default: clean up)"
  );
  purge.option("--index <name>", "Override the search index name (default: sitecore_master_index)");
  purge.action(async (options) => {
    await runCleanupDeadTemplates(options);
  });

  command.addCommand(purge);
  return command;
};
