import { Command, Option } from "commander";
import { runBriefList } from "@/brief/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createBriefListCommand = (): Command => {
  const command = new Command("list").description("List briefs in the tenant.");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--limit <n>", "Page size").argParser((v) => Number(v)));
  command.addOption(new Option("--locale <code>", "Filter by locale (e.g. en-us)"));

  command.action(async (options) => {
    await runBriefList(options);
  });

  return command;
};
