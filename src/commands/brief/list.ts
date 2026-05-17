import { Command, Option } from "commander";
import { runBriefList } from "@/brief/tasks";
import { addConfigOption, addOrgScopeOptions, addVerbosityOptions } from "../shared";

export const createBriefListCommand = (): Command => {
  const command = new Command("list").description("List briefs in the tenant.");

  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--limit <n>", "Page size").argParser((v) => Number(v)));
  command.addOption(new Option("--locale <code>", "Filter by locale (e.g. en-us)"));

  command.action(async (options) => {
    await runBriefList(options);
  });

  return command;
};
