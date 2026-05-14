import { Command } from "commander";
import { runAuditAll } from "@/hygiene/tasks";
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
      "  $ scai audit all                              # run everything, print JSON\n" +
      "  $ scai audit all --baseline                   # only new findings vs. baseline\n" +
      "  $ scai audit all --output report.md           # Markdown report\n" +
      "  $ scai audit all --include broken-links,unused-media\n" +
      "  $ scai audit all --update-baseline            # accept everything as the new baseline\n"
  );
  command.action(async (options) => {
    await runAuditAll(options);
  });
  return command;
};
