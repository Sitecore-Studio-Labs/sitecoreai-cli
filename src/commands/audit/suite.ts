import { Command } from "commander";
import { runAuditSuiteRun } from "@/hygiene/tasks/audit-suite-run";
import { collectList } from "../shared";
import { addAuditBaseOptions } from "./shared";

export const createAuditSuiteCommand = (): Command => {
  const command = new Command("suite").description(
    "Run a YAML-defined audit pipeline (codified hygiene policy)"
  );

  const run = new Command("run").description("Execute a suite file");
  addAuditBaseOptions(run);
  run.requiredOption("--file <path>", "Path to the audit-suite YAML file");
  run.option("--only <audits>", "Comma-separated subset of suite audits to run", collectList, []);
  run.addHelpText(
    "after",
    "\nSuite file format (YAML):\n" +
      "  version: 1\n" +
      "  name: monthly-hygiene\n" +
      "  audits:\n" +
      "    - name: broken-links\n" +
      "      options: { root: /sitecore/content/MySite, limit: 1000 }\n" +
      "    - name: duplicates\n" +
      "      options: { min-group-size: 3 }\n" +
      "  output: { format: markdown, path: ./reports/{date}.md }\n" +
      "  baseline: { enabled: true }\n" +
      "\nOutput-path tokens: {date}, {datetime}, {env}, {suite}.\n"
  );
  run.action(async (options) => {
    await runAuditSuiteRun(options);
  });
  command.addCommand(run);
  return command;
};
