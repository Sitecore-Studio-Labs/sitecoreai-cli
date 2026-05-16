import { Command } from "commander";
import { runAuditLargeFields } from "@/hygiene/tasks/audit/large-fields";
import { addAuditBaseOptions } from "./shared";

export const createAuditLargeFieldsCommand = (): Command => {
  const command = new Command("large-fields").description(
    "Find content items with field values exceeding a byte-size threshold"
  );
  const list = new Command("list").description(
    "List items whose individual field values are >= --threshold bytes (default 100KB)"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language");
  list.option(
    "--threshold <bytes>",
    "Field-size threshold in bytes (default 100000 = 100KB)",
    (v) => parseInt(v, 10)
  );
  list.option("--include-system-fields", "Include __-prefixed system fields in the size check");
  list.action(async (options) => {
    await runAuditLargeFields(options);
  });
  command.addCommand(list);
  return command;
};
