import { Command } from "commander";
import { runCleanupLanguageVersionAdd } from "@/hygiene/tasks";
import { collectList } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupLanguageVersionsCommand = (): Command => {
  const command = new Command("language-versions").description(
    "Bulk-create language versions across items so translators can pick them up"
  );

  const add = new Command("add").description(
    "Add empty (or copied) language versions to items in --root"
  );
  addCleanupBaseOptions(add);
  add.requiredOption(
    "--languages <codes>",
    "Comma-separated language codes to add (e.g. fr,es,de)",
    collectList,
    []
  );
  add.option(
    "--from-language <code>",
    "Source language to copy fields from. Default: seed the new version empty"
  );
  add.option(
    "--template-pattern <regex>",
    "Restrict to items whose templateName matches (strongly recommended)"
  );
  add.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  add.option("--limit <count>", "Cap on items inspected (default: 5000)", (v) => parseInt(v, 10));
  add.option(
    "--max-adds <count>",
    "Maximum number of (item, language) versions created per run (default: 500)",
    (v) => parseInt(v, 10)
  );
  add.option("--index <name>", "Override the search index name");
  add.option("--include-system", "Include /sitecore/system items in the scan (off by default)");
  add.option("--cache", "Use the on-disk field cache for the discovery phase");
  add.action(async (options) => {
    await runCleanupLanguageVersionAdd(options);
  });

  command.addCommand(add);
  return command;
};
