import { Command } from "commander";
import { runAuditFallbackDrift } from "@/hygiene/tasks";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditFallbackDriftCommand = (): Command => {
  const command = new Command("fallback-drift").description(
    "Find items where target-language versions lag the reference language by N days"
  );
  const list = new Command("list").description(
    "Compare updatedDate between --reference-language and --target-language versions"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.requiredOption(
    "--target-languages <codes>",
    "Comma-separated target language codes (e.g. fr,de,es)",
    collectList,
    []
  );
  list.option("--reference-language <code>", "Reference (source) language (default: en)");
  list.option(
    "--drift-days <count>",
    "Flag items where target lags reference by this many days (default 30)",
    (v) => parseInt(v, 10)
  );
  list.action(async (options) => {
    await runAuditFallbackDrift(options);
  });
  command.addCommand(list);
  return command;
};
