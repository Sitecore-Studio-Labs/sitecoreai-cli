import { Command } from "commander";
import { runCleanupRename } from "@/hygiene/tasks/cleanup/rename";
import { withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupRenameCommand = (): Command => {
  const command = new Command("rename").description(
    "Bulk-rename items by pattern (modifies item Name and thus the URL slug)"
  );

  const apply = new Command("apply").description(
    "Rename items whose name matches --pattern to the --replacement form"
  );
  addCleanupBaseOptions(apply);
  apply.requiredOption(
    "--pattern <regex>",
    "JS regex (or literal with --literal) applied to item Name"
  );
  apply.requiredOption(
    "--replacement <text>",
    "Replacement string. Supports JS regex backreferences ($1, $&, $<name>)"
  );
  apply.option("--literal", "Treat --pattern as a literal string");
  apply.option("--ignore-case", "Case-insensitive match");
  apply.option("--flags <flags>", "Custom regex flags (g intentionally not added)");
  apply.option(
    "--template-pattern <regex>",
    "Restrict to items whose templateName matches (strongly recommended)"
  );
  apply.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  apply.option("--limit <count>", "Cap on items inspected (default: 5000)", (v) => parseInt(v, 10));
  apply.option(
    "--max-renames <count>",
    "Maximum number of items renamed per run (default: 100)",
    (v) => parseInt(v, 10)
  );
  apply.option("--index <name>", "Override the search index name");
  apply.option("--include-system", "Include /sitecore/system items in the scan (off by default)");
  apply.option("--cache", "Use the on-disk field cache for the discovery phase");
  apply.addHelpText(
    "after",
    "\nRenames change the URL slug. Coordinate with redirects and sitemap\n" +
      "regeneration in the surrounding workflow. To change the editor-visible\n" +
      "display name (without changing the slug), use:\n" +
      "  scai hygiene cleanup field-set apply --field '__Display Name' --value 'new name'\n"
  );
  apply.action(withApplyGate(runCleanupRename));

  command.addCommand(apply);
  return command;
};
