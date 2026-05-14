import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runDeployHealth } from "../deploy/tasks/health";

const parsePositiveInt =
  (label: string) =>
  (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
  };

export const createHealthCommand = (): Command => {
  const command = new Command("health").description(
    "Show health of every environment in the active tenant"
  );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command
    .addOption(new Option("--project <value>", "Filter to environments in this project"))
    .addOption(new Option("--type <cm|eh>", "Filter by environment type"))
    .addOption(new Option("--no-probe", "List status only — skip per-env probes"))
    .addOption(
      new Option("--concurrency <n>", "Probe concurrency (default 8)").argParser(
        parsePositiveInt("--concurrency")
      )
    );

  command.addHelpText(
    "after",
    `\nExamples:\n  $ scai health\n  $ scai health --json\n  $ scai health --type cm\n  $ scai health --no-probe\n`
  );

  command.action(async (options) => runDeployHealth(options));

  return command;
};
