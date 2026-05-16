import { Command } from "commander";
import { runAuditAltTextMissing } from "@/hygiene/tasks/audit/alt-text-missing";
import { addAuditBaseOptions } from "./shared";

export const createAuditAltTextMissingCommand = (): Command => {
  const command = new Command("alt-text-missing").description(
    "Find Image-field values with empty alt text (accessibility audit)"
  );
  const list = new Command("list").description(
    "List items whose Image fields have empty or missing alt attribute"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language");
  list.action(async (options) => {
    await runAuditAltTextMissing(options);
  });
  command.addCommand(list);
  return command;
};
