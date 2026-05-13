import { Command } from "commander";
import { runAuditDeadTemplates } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditDeadTemplatesCommand = (): Command => {
  const command = new Command("dead-templates").description(
    "Find item templates with zero items derived from them"
  );

  const list = new Command("list").description("List unused item templates");
  addAuditBaseOptions(list);
  list.option("--root <path>", "Template-tree root to scan (default: /sitecore/templates)");
  list.action(async (options) => {
    await runAuditDeadTemplates(options);
  });

  command.addCommand(list);
  return command;
};
