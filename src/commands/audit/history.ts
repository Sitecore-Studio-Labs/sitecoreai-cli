import { Command } from "commander";
import { runHistoryCapture, runHistoryDiff, runHistoryList } from "@/hygiene/tasks/audit/history";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions, collectList } from "../shared";

export const createAuditHistoryCommand = (): Command => {
  const command = new Command("history").description(
    "Snapshot audit-all results over time + diff across snapshots"
  );

  const capture = new Command("capture").description(
    "Run `audit all` and persist the result to .scai/audit-history/<env>/"
  );
  addEnvironmentOption(capture);
  addConfigOption(capture);
  addVerbosityOptions(capture);
  capture.option("--root <path>", "Default content root for sub-audits");
  capture.option("--limit <count>", "Cap per audit", (v) => parseInt(v, 10));
  capture.option("--include-system", "Include /sitecore/system items");
  capture.option("--include <audits>", "Comma-separated audit names", collectList, []);
  capture.option(
    "--exclude-audit <audits>",
    "Comma-separated audit names to skip",
    collectList,
    []
  );
  capture.option("--exclude <path>", "Path-prefix exclusions", collectList, []);
  capture.option("--since <date>", "Only items updated on/after this date");
  capture.action(async (options) => {
    await runHistoryCapture(options);
  });
  command.addCommand(capture);

  const list = new Command("list").description("List captured snapshots, newest first");
  addEnvironmentOption(list);
  addConfigOption(list);
  addVerbosityOptions(list);
  list.action(async (options) => {
    await runHistoryList(options);
  });
  command.addCommand(list);

  const diff = new Command("diff").description(
    "Compare two snapshots and show per-audit deltas (defaults to last two)"
  );
  addEnvironmentOption(diff);
  addConfigOption(diff);
  addVerbosityOptions(diff);
  diff.option("--from <file>", "Snapshot path to compare FROM (default: second-most-recent)");
  diff.option("--to <file>", "Snapshot path to compare TO (default: most-recent)");
  diff.action(async (options) => {
    await runHistoryDiff(options);
  });
  command.addCommand(diff);

  return command;
};
