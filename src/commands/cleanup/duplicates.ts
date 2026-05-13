import { Command, Option } from "commander";
import { runCleanupDuplicates } from "@/hygiene/tasks";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupDuplicatesCommand = (): Command => {
  const command = new Command("duplicates").description(
    "Delete duplicate-content items, keeping one per group per --keep-rule"
  );

  const purge = new Command("purge").description(
    "Delete duplicates per keep-rule (default: oldest creation date wins)"
  );
  addCleanupBaseOptions(purge);
  purge.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  purge.option("--language <code>", "Restrict to one language (default: include all)");
  purge.option(
    "--min-group-size <count>",
    "Only act on groups with at least this many duplicates (default: 2)",
    (v) => parseInt(v, 10)
  );
  purge.option("--limit <count>", "Cap on the number of items inspected (default: 5000)", (v) =>
    parseInt(v, 10)
  );
  purge.option("--index <name>", "Override the search index name");
  purge.option("--include-system", "Include /sitecore/system items in the scan (off by default)");
  purge.option(
    "--include-system-fields",
    "Include __-prefixed system fields when computing the content hash"
  );
  purge.addOption(
    new Option("--keep-rule <rule>", "Which member of each duplicate group survives")
      .choices(["oldest", "newest", "shortest-path", "interactive"])
      .default("oldest")
  );
  purge.option("--concurrency <count>", "Delete concurrency (default: 4)", (v) => parseInt(v, 10));
  purge.option("--batch-size <count>", "Aliased GraphQL batch size for field reads", (v) =>
    parseInt(v, 10)
  );
  purge.addHelpText(
    "after",
    "\nNote: refs to deleted duplicates become broken links.\n" +
      "Run `scai audit broken-links list` after a purge to surface fallout.\n"
  );
  purge.action(async (options) => {
    await runCleanupDuplicates(options);
  });

  command.addCommand(purge);
  return command;
};
