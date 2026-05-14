import { Command } from "commander";
import { runAuditSlugConflicts } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditSlugConflictsCommand = (): Command => {
  const command = new Command("slug-conflicts").description(
    "Find siblings sharing the same item name (URL conflict)"
  );
  const list = new Command("list").description(
    "List parent paths where two or more sibling items share the same name"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language");
  list.option(
    "--no-case-insensitive",
    "Compare slugs case-sensitively (off by default — URL routing is usually case-insensitive)"
  );
  list.action(async (options) => {
    await runAuditSlugConflicts(options);
  });
  command.addCommand(list);
  return command;
};
