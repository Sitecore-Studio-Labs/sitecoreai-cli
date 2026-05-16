import { Command } from "commander";
import { runAuditDuplicates } from "@/hygiene/tasks/audit/duplicates";
import { addAuditBaseOptions } from "./shared";

export const createAuditDuplicatesCommand = (): Command => {
  const command = new Command("duplicates").description(
    "Find items with byte-identical authored content"
  );

  const list = new Command("list").description(
    "List duplicate-content groups (>= 2 members each, by default)"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language (default: include all)");
  list.option(
    "--min-group-size <count>",
    "Only report groups with at least this many duplicates (default: 2)",
    (v) => parseInt(v, 10)
  );
  list.option(
    "--include-system-fields",
    "Include __-prefixed system fields when computing the content hash (off by default to ignore per-item metadata)"
  );
  list.action(async (options) => {
    await runAuditDuplicates(options);
  });

  command.addCommand(list);
  return command;
};
