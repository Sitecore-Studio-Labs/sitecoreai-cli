import { Command } from "commander";
import { runCleanupFindReplace } from "@/hygiene/tasks";
import { collectList } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupFindReplaceCommand = (): Command => {
  const command = new Command("find-replace").description(
    "Apply a find-replace operation across content field values"
  );

  const apply = new Command("apply").description(
    "Replace --pattern with --replacement in matching field values"
  );
  addCleanupBaseOptions(apply);
  apply.requiredOption(
    "--pattern <regex>",
    "Regex pattern (or literal with --literal) to match against field values"
  );
  apply.requiredOption(
    "--replacement <text>",
    "Replacement string. Supports JS regex backreferences ($1, $&, $<name>)"
  );
  apply.option("--literal", "Treat --pattern as a literal string");
  apply.option("--ignore-case", "Case-insensitive match");
  apply.option("--flags <flags>", "Custom regex flags (g is always added). Default 'g'");
  apply.option(
    "--fields <names>",
    "Comma-separated field names to search (default: all author-facing fields)",
    collectList,
    []
  );
  apply.option(
    "--include-system-fields",
    "Include __-prefixed system fields in the search (off by default; touching __Renderings via regex will mangle XML)"
  );
  apply.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  apply.option("--language <code>", "Restrict to one language");
  apply.option("--limit <count>", "Cap on items inspected (default: 5000)", (v) => parseInt(v, 10));
  apply.option(
    "--max-mutations <count>",
    "Maximum number of items to mutate per run (default: 100). Defends against runaway regex matches",
    (v) => parseInt(v, 10)
  );
  apply.option("--index <name>", "Override the search index name");
  apply.option("--include-system", "Include /sitecore/system items in the scan (off by default)");
  apply.option("--cache", "Use the on-disk field cache for the discovery phase");
  apply.addHelpText(
    "after",
    "\nThe pattern is a JS RegExp (or literal with --literal). The\n" +
      "replacement supports backreferences. Always run `scai audit\n" +
      "find-replace list --pattern ...` first to verify match scope before\n" +
      "applying. Pair with --what-if to preview the changes without\n" +
      "touching the tenant.\n"
  );
  apply.action(async (options) => {
    await runCleanupFindReplace(options);
  });

  command.addCommand(apply);
  return command;
};
