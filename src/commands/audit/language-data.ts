import { Command } from "commander";
import { runAuditLanguageData } from "@/hygiene/tasks/audit-language-data";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditLanguageDataCommand = (): Command => {
  const command = new Command("language-data").description(
    "Find items with empty per-language entries (no versions) — read-only diagnostic"
  );

  const list = new Command("list").description(
    "List (item, language) pairs where the language entry exists but has zero versions"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option(
    "--languages <value>",
    "Comma-separated language codes to inspect (default: all languages found under --root)",
    collectList,
    []
  );
  list.addHelpText(
    "after",
    "\nNote: XM Cloud Authoring API does not expose per-item language-entry removal,\n" +
      "so this command is read-only. Operators clean up empty entries by either\n" +
      "authoring at least one version in the affected language, or removing the\n" +
      "language tenant-wide via the Sitecore admin tools.\n"
  );
  list.action(async (options) => {
    await runAuditLanguageData(options);
  });

  command.addCommand(list);
  return command;
};
