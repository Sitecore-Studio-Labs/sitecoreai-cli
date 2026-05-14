import { Command } from "commander";
import { runAuditTranslationCoverage } from "@/hygiene/tasks/audit-translation-coverage";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditTranslationCoverageCommand = (): Command => {
  const command = new Command("translation-coverage").description(
    "Measure translation coverage between a reference and target language(s)"
  );
  const list = new Command("list").description(
    "Compare item sets between --reference-language and each --target-language"
  );
  addAuditBaseOptions(list);
  list.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  list.requiredOption(
    "--target-languages <codes>",
    "Comma-separated target language codes to compare (e.g. fr,de,es)",
    collectList,
    []
  );
  list.option("--reference-language <code>", "Reference (source) language (default: en)");
  list.option(
    "--min-coverage-percent <pct>",
    "Only flag languages below this coverage % (default 0 = report all)",
    (v) => parseInt(v, 10)
  );
  list.action(async (options) => {
    await runAuditTranslationCoverage(options);
  });
  command.addCommand(list);
  return command;
};
