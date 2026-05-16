import { Command } from "commander";
import { runBriefShow } from "@/brief/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createBriefShowCommand = (): Command => {
  const command = new Command("show")
    .description("Show one brief by id, including its field values, tasks, and comments.")
    .argument("<briefId>", "Brief UUID");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (briefId: string, options) => {
    await runBriefShow({ ...options, briefId });
  });

  return command;
};
