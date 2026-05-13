import { Command } from "commander";
import { runCleanupVersionsPrune } from "@/hygiene/tasks";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupVersionsCommand = (): Command => {
  const command = new Command("versions").description(
    "Prune per-item version history down to the N most recent versions"
  );

  const prune = new Command("prune").description(
    "Delete versions older than the N most recent per (item, language)"
  );
  addCleanupBaseOptions(prune);
  prune.requiredOption(
    "--keep <count>",
    "Number of most-recent versions to keep per (item, language)",
    (v) => parseInt(v, 10)
  );
  prune.requiredOption(
    "--root <path>",
    "Content-tree root to scope the prune (e.g. /sitecore/content/MySite)"
  );
  prune.option(
    "--language <code>",
    "Restrict pruning to one language (default: all languages found per item)"
  );
  prune.option("--limit <count>", "Cap on the number of items inspected", (v) => parseInt(v, 10));
  prune.option("--index <name>", "Override the search index name (default: sitecore_master_index)");
  prune.option("--concurrency <count>", "Concurrency for version reads and deletes", (v) =>
    parseInt(v, 10)
  );
  prune.option("--include-system", "Include /sitecore/system and platform items in the prune");
  prune.action(async (options) => {
    await runCleanupVersionsPrune(options);
  });

  command.addCommand(prune);
  return command;
};
