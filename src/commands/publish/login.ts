import { Command, Option } from "commander";
import { runPublishingLogin } from "@/publishing/tasks";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const createPublishLoginCommand = (): Command => {
  const command = new Command("login").description(
    "Authenticate for publishing operations — interactive device-code flow that requests `xmcpub.*` scopes specifically and stores the token in a publishing-scoped keychain entry separate from the deploy token."
  );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.addOption(
    new Option(
      "--client-id <id>",
      "Override the Auth0 client id. Defaults to the scai public device-flow client; provide a different client id if that one isn't authorized for xmcpub.* scopes."
    )
  );

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai publish login -n sandbox\n" +
      "  $ scai publish login -n sandbox --client-id <auth0-client-id>\n"
  );

  command.action(async (options) => runPublishingLogin(options));

  return command;
};
