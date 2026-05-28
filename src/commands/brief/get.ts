import { Command } from "commander";
import { runBriefGet } from "@/brief/tasks";
import { addConfigOption, addOrgScopeOptions, addVerbosityOptions } from "../shared";

export const createBriefGetCommand = (): Command => {
  const command = new Command("get")
    .description("Get one brief by id, including its field values, tasks, and comments.")
    .argument("<briefId>", "Brief UUID");

  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (briefId: string, options) => {
    await runBriefGet({ ...options, briefId });
  });

  return command;
};
