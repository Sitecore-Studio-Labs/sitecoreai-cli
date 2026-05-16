import { Command, Option } from "commander";
import { addConfigOption, addVerbosityOptions } from "./shared";
import { runSetupClients } from "../serialization/tasks/env/setup-clients";

/**
 * `scai setup clients [name]` — list, or with `--delete <id>` remove,
 * the automation clients (credentials) in an environment's
 * organization, flagging the ones scai minted. Companion to
 * `scai setup env` (mint) and `scai setup status` (the credential
 * matrix).
 */
export const createSetupClientsCommand = (): Command => {
  const command = new Command("clients")
    .description(
      "List, or delete, the automation clients (credentials) in an environment's organization."
    )
    .argument("[name]", "Environment profile name (defaults to the configured default).")
    .addOption(new Option("--delete <id>", "Delete the client with this id instead of listing."))
    .addOption(new Option("-f, --force", "Skip the delete confirmation prompt."));

  addConfigOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai setup clients              # clients in the default env's org\n" +
      "  $ scai setup clients production   # clients in production's org\n" +
      "  $ scai setup clients --json       # machine-readable\n" +
      "  $ scai setup clients --delete <id>          # delete one (with confirmation)\n" +
      "  $ scai setup clients --delete <id> --force  # delete without prompting\n"
  );

  command.action(async (name: string | undefined, options) =>
    runSetupClients({ ...options, environmentName: name })
  );

  return command;
};
