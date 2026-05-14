import { Command } from "commander";
import { runAuditFindReplace } from "@/hygiene/tasks/audit-find-replace";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditFindReplaceCommand = (): Command => {
  const command = new Command("find-replace").description(
    "Search content field values for a pattern (regex or literal). Read-only counterpart to `cleanup find-replace`."
  );

  const list = new Command("list").description(
    "List items whose fields contain matches for --pattern"
  );
  addAuditBaseOptions(list);
  list.requiredOption(
    "--pattern <regex>",
    "Regex pattern (or literal string with --literal) to match against field values"
  );
  list.option("--literal", "Treat --pattern as a literal string (regex special chars escaped)");
  list.option("--ignore-case", "Case-insensitive match (sets the i regex flag)");
  list.option("--flags <flags>", "Custom regex flags (g is always added). Default 'g'");
  list.option(
    "--fields <names>",
    "Comma-separated field names to search (default: all author-facing fields)",
    collectList,
    []
  );
  list.option(
    "--include-system-fields",
    "Include __-prefixed system fields in the search (off by default)"
  );
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language");
  list.option(
    "--max-matches-per-item <count>",
    "Maximum number of sample snippets captured per matching item (default 10)",
    (v) => parseInt(v, 10)
  );
  list.action(async (options) => {
    await runAuditFindReplace(options);
  });

  command.addCommand(list);
  return command;
};
