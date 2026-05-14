import { Command } from "commander";
import { runAuditEmptyLinks } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditEmptyLinksCommand = (): Command => {
  const command = new Command("empty-links").description(
    "Find General Link / CTA fields that are structurally empty (link goes nowhere)"
  );
  const list = new Command("list").description(
    "List items whose Link fields have no target (the visible button, the invisible href)"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.option("--language <code>", "Restrict to one language");
  list.option(
    "--template-pattern <regex>",
    "Restrict to items whose templateName matches this pattern (e.g. CTA|Button|Card)"
  );
  list.addHelpText(
    "after",
    "\nWhat this catches (not caught by `audit broken-links`):\n" +
      "  - Link fields with NO <link> tag at all (truly empty)\n" +
      "  - <link …/> with all targeting attrs (url/id/anchor/mediaid) empty\n\n" +
      "Internal-ref-doesn't-resolve is `audit broken-links`. Items where every\n" +
      "field is empty is `audit empty-items`.\n"
  );
  list.action(async (options) => {
    await runAuditEmptyLinks(options);
  });
  command.addCommand(list);
  return command;
};
