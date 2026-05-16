import { Command } from "commander";
import { runAuditAll } from "@/hygiene/tasks/audit/all";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditAllCommand = (): Command => {
  const command = new Command("all").description(
    "Run every audit and emit a consolidated report (skip find-replace; it needs --pattern)"
  );
  addAuditBaseOptions(command);
  command.option(
    "--include <audits>",
    "Comma-separated list of audit names to run (default: every audit except find-replace)",
    collectList,
    []
  );
  command.option(
    "--exclude-audit <audits>",
    "Comma-separated list of audit names to skip",
    collectList,
    []
  );
  command.option(
    "--update-baseline",
    "After running, write the current findings to the baseline file (use after manual review)"
  );
  command.option(
    "--root <path>",
    "Default content root for sub-audits (default: /sitecore/content)"
  );
  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai hygiene audit all                              # run everything, print JSON\n" +
      "  $ scai hygiene audit all --baseline                   # only new findings vs. baseline\n" +
      "  $ scai hygiene audit all --output report.md           # Markdown report\n" +
      "  $ scai hygiene audit all --include broken-links,unused-media\n" +
      "  $ scai hygiene audit all --update-baseline            # accept everything as the new baseline\n"
  );
  command.action(async (options) => {
    await runAuditAll(options);
  });
  return command;
};
