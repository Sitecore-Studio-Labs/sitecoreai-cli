import { Command } from "commander";
import { runAuditBrokenLinks } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditBrokenLinksCommand = (): Command => {
  const command = new Command("broken-links").description(
    "Find content items with internal links that point to deleted items"
  );

  const list = new Command("list").description(
    "List items containing broken internal links (RichText, General Link, Multilist)"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root to scan (default: /sitecore/content)");
  list.option("--batch-size <count>", "Aliased GraphQL batch size for field reads", (v) =>
    parseInt(v, 10)
  );
  list.action(async (options) => {
    await runAuditBrokenLinks(options);
  });

  command.addCommand(list);
  return command;
};
