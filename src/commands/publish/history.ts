import { Command, Option } from "commander";
import { runPublishHistory } from "@/publishing/tasks/history";
import { addVerbosityOptions } from "../shared";

const parseIntOpt = (value: string): number => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected positive integer, got '${value}'.`);
  }
  return n;
};

export const createPublishHistoryCommand = (): Command => {
  const command = new Command("history")
    .description(
      "Read the local publishing audit log at ~/.sitecoreai/audit.log (overridable via SITECOREAI_AUDIT_LOG). Filter by env / time / command / outcome. Use --json for newline-delimited JSON suitable for piping into jq."
    )
    .option("--env <name>", "Filter to entries from this env (matches scope.envName).")
    .option(
      "--since <spec>",
      "Filter to entries newer than this. ISO 8601 (e.g. 2026-05-01) or relative (24h, 7d, 30m)."
    )
    .option(
      "--command <substr>",
      "Substring match against the `command` field (e.g. 'item', 'unpublish', 'content version')."
    )
    .addOption(
      new Option("--outcome <value>", "Filter by outcome.").choices(["ok", "error", "cancelled"])
    )
    .addOption(
      new Option(
        "--scan-limit <N>",
        "How many recent entries to scan before filtering (default 500). Increase for deep history searches."
      ).argParser(parseIntOpt)
    )
    .addOption(
      new Option("--limit <N>", "Max entries to print after filtering (default 50).").argParser(
        parseIntOpt
      )
    );

  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content publish history\n" +
      "  $ scai content publish history --env sandbox --since 24h\n" +
      "  $ scai content publish history --command 'publish all' --outcome ok\n" +
      "  $ scai content publish history --outcome error --json | jq -r '.errorMessage'\n"
  );

  command.action(async (options) => {
    await runPublishHistory(options);
  });

  return command;
};
