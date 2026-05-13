import { Command } from "commander";
import { runAuditPersonalizationBroken } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditPersonalizationBrokenCommand = (): Command => {
  const command = new Command("personalization-broken").description(
    "Find pages with personalization rules referencing missing items"
  );

  const list = new Command("list").description(
    "List items with broken personalization variant or rule-set references"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.action(async (options) => {
    await runAuditPersonalizationBroken(options);
  });

  command.addCommand(list);
  return command;
};
