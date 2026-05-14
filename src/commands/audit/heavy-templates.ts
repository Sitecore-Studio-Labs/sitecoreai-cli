import { Command } from "commander";
import { runAuditHeavyTemplates } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditHeavyTemplatesCommand = (): Command => {
  const command = new Command("heavy-templates").description(
    "Find templates with more than N fields (slow editor + brittle fixtures)"
  );
  const list = new Command("list").description(
    "List templates with field count >= --threshold (default 50)"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Template-tree root (default: /sitecore/templates)");
  list.option("--threshold <count>", "Field-count threshold (default 50)", (v) => parseInt(v, 10));
  list.action(async (options) => {
    await runAuditHeavyTemplates(options);
  });
  command.addCommand(list);
  return command;
};
