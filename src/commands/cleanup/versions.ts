import { Command } from "commander";
import { runCleanupVersionsArchive, runCleanupVersionsPrune } from "@/hygiene/tasks";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupVersionsCommand = (): Command => {
  const command = new Command("versions").description(
    "Prune or archive per-item version history down to the N most recent versions"
  );

  // ── prune (destructive) ──────────────────────────────────────────
  const prune = new Command("prune").description(
    "Permanently delete versions older than the N most recent per (item, language)"
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

  // ── archive (soft / reversible) ──────────────────────────────────
  const archive = new Command("archive").description(
    "Move versions older than the N most recent per (item, language) to the Sitecore archive (reversible)"
  );
  addCleanupBaseOptions(archive);
  archive.requiredOption(
    "--keep <count>",
    "Number of most-recent versions to keep per (item, language)",
    (v) => parseInt(v, 10)
  );
  archive.requiredOption("--root <path>", "Content-tree root to scope the archive");
  archive.option("--language <code>", "Restrict to one language");
  archive.option("--limit <count>", "Cap on items inspected", (v) => parseInt(v, 10));
  archive.option("--index <name>", "Override the search index name");
  archive.option("--concurrency <count>", "Concurrency", (v) => parseInt(v, 10));
  archive.option("--include-system", "Include platform items");
  archive.option(
    "--archive-name <name>",
    "Name of the Sitecore archive bucket (default: tenant default)"
  );
  archive.addHelpText(
    "after",
    "\nUnlike `versions prune`, archived versions can be restored via the\n" +
      "Sitecore admin UI (restoreArchivedVersion) — this is the reversible\n" +
      "alternative for cases where you want to trim version history but keep\n" +
      "an undo path.\n"
  );
  archive.action(async (options) => {
    await runCleanupVersionsArchive(options);
  });
  command.addCommand(archive);

  return command;
};
