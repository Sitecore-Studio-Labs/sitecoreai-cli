import { Command } from "commander";
import { runCleanupArchivePurge } from "@/hygiene/tasks";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupArchiveCommand = (): Command => {
  const command = new Command("archive").description(
    "Operations against the Sitecore archive (recycle bin)"
  );

  const purge = new Command("purge").description(
    "Permanently delete archived items older than --older-than-days N"
  );
  addCleanupBaseOptions(purge);
  purge.option(
    "--older-than-days <count>",
    "Only purge archived items older than N days (default: 30)",
    (v) => parseInt(v, 10)
  );
  purge.option("--limit <count>", "Cap on items purged in one run (default: 1000)", (v) =>
    parseInt(v, 10)
  );
  purge.option("--archive-name <name>", "Limit to a specific archive (default: all archives)");
  purge.option("--page-size <count>", "Page size for archive listing (default: 100)", (v) =>
    parseInt(v, 10)
  );
  purge.option("--concurrency <count>", "Concurrency for delete calls (default: 4)", (v) =>
    parseInt(v, 10)
  );
  purge.action(async (options) => {
    await runCleanupArchivePurge(options);
  });

  command.addCommand(purge);
  return command;
};
