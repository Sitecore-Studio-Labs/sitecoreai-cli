import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runDeployToken } from "../serialization/tasks";

export const createLoginCommand = (): Command => {
  const command = new Command("login").description(
    "Authenticate with SitecoreAI and store an access token (Deploy + CM/admin scopes)"
  );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command
    .addOption(new Option("--client-id <id>", "SitecoreAI client ID"))
    .addOption(new Option("--client-secret <secret>", "SitecoreAI client secret"))
    .addOption(
      new Option("--use-client-credentials", "Use client credentials instead of interactive login")
    )
    .addOption(new Option("--print", "Print the access token to stdout"));

  command.addHelpText(
    "after",
    "\nExamples:\n  $ scai login -n demo\n  $ scai login -n demo --use-client-credentials\n"
  );

  command.action(async (options) => runDeployToken(options));

  return command;
};
