import { Command } from "commander";
import { runAuditMissingMeta } from "@/hygiene/tasks";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditMissingMetaCommand = (): Command => {
  const command = new Command("missing-meta").description(
    "Find items missing required (SEO) field values"
  );
  const list = new Command("list").description(
    "List items lacking any of the required fields (default SEO set)"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language");
  list.option(
    "--required-fields <names>",
    "Comma-separated required field names (default: meta-title,meta-description,og-image,og-title)",
    collectList,
    []
  );
  list.option(
    "--template-pattern <regex>",
    "Only check items whose templateName matches (e.g. 'Page' for SXA pages)"
  );
  list.action(async (options) => {
    await runAuditMissingMeta(options);
  });
  command.addCommand(list);
  return command;
};
