import { Command, Option } from "commander";
import { runCleanupSlugConflicts } from "@/hygiene/tasks/cleanup-slug-conflicts";
import { withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupSlugConflictsCommand = (): Command => {
  const command = new Command("slug-conflicts").description(
    "Resolve sibling-name conflicts surfaced by `audit slug-conflicts` (delete or rename losers per --keep-rule)"
  );

  const purge = new Command("purge").description(
    "Delete or rename losing siblings per --keep-rule (default: oldest wins, action delete)"
  );
  addCleanupBaseOptions(purge);
  purge.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  purge.option("--language <code>", "Restrict to one language (default: include all)");
  purge.option("--limit <count>", "Cap on the number of items inspected (default: 5000)", (v) =>
    parseInt(v, 10)
  );
  purge.option("--index <name>", "Override the search index name");
  purge.option("--include-system", "Include /sitecore/system items in the scan (off by default)");
  purge.option(
    "--case-insensitive",
    "Treat sibling names as case-insensitive (default: on; pass --no-case-insensitive to disable)"
  );
  purge.option(
    "--no-case-insensitive",
    "Treat sibling names as case-sensitive (off by default — most renderers do case-insensitive URL resolution)"
  );
  purge.addOption(
    new Option("--keep-rule <rule>", "Which member of each conflict group survives")
      .choices(["oldest", "newest", "shortest-path", "interactive"])
      .default("oldest")
  );
  purge.addOption(
    new Option("--action <action>", "What to do with the losers")
      .choices(["delete", "rename"])
      .default("delete")
  );
  purge.option(
    "--rename-suffix <template>",
    "Suffix template for --action rename. Placeholders: {shortId} (8-char itemId prefix), {full} (32-char id). Default: '-{shortId}'."
  );
  purge.option("--concurrency <count>", "Delete/rename concurrency (default: 4)", (v) =>
    parseInt(v, 10)
  );
  purge.addHelpText(
    "after",
    "\nAction trade-offs:\n" +
      "  --action delete   — `deleteItem(permanently: true)` on losers. Inbound\n" +
      "                       refs to deleted items become broken — run\n" +
      "                       `scai audit broken-links list` afterward.\n" +
      "  --action rename   — `renameItem(name: oldName + suffix)`. Preserves\n" +
      "                       inbound refs (the itemId doesn't change) but\n" +
      "                       leaves stale-named siblings under the parent.\n" +
      "                       URLs depending on the old slug will break.\n" +
      "\nKeep-rule note: the audit report has no created/updated dates, so\n" +
      "  `oldest` and `newest` fall back to itemId-stable ordering. Use\n" +
      "  `--keep-rule interactive` when the survivor decision matters per-item.\n"
  );
  purge.action(withApplyGate(runCleanupSlugConflicts));

  command.addCommand(purge);
  return command;
};
