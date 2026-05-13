import { Command } from "commander";
import { runAuditEmptyItems } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditEmptyItemsCommand = (): Command => {
  const command = new Command("empty-items").description(
    "Find items with no authored field values"
  );

  const list = new Command("list").description(
    "List items where every non-system field is empty or whitespace"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language (default: include all)");
  list.action(async (options) => {
    await runAuditEmptyItems(options);
  });

  command.addCommand(list);
  return command;
};
