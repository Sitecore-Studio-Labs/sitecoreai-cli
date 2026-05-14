import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runLogout } from "../serialization/tasks/env/logout";

export const createLogoutCommand = (): Command => {
  const command = new Command("logout").description("Clear stored authentication tokens");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command
    .addOption(new Option("--all", "Clear tokens for all environments"))
    .action(async (options) => runLogout(options));

  command.addHelpText("after", "\nExamples:\n  $ scai logout -n demo\n  $ scai logout --all\n");

  return command;
};
