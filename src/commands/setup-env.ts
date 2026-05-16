import { Command, Option } from "commander";
import { addConfigOption, addVerbosityOptions } from "./shared";
import { runSetupEnv } from "../serialization/tasks/env/setup-env";

/**
 * `scai setup env <name>` — provision the environment-scoped CM
 * automation client for an environment. Uses the env's deploy token
 * (from `scai setup login`) to list-or-mint a `scai-cm-<env>` client
 * via the Deploy clients API, then stores the credential in the OS
 * keychain. Idempotent: a second run is a no-op unless `--rotate`.
 */
export const createSetupEnvCommand = (): Command => {
  const command = new Command("env")
    .description("Provision the environment-scoped CM automation client for an environment.")
    .argument("<name>", "Environment profile name from sitecoreai.cli.json")
    .addOption(new Option("-w, --what-if", "Preview the action without minting or deleting."))
    .addOption(
      new Option("--rotate", "Delete and re-mint the client even if one is already provisioned.")
    );

  addConfigOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai setup env production            # mint the CM client (or no-op if present)\n" +
      "  $ scai setup env production --what-if  # preview\n" +
      "  $ scai setup env production --rotate   # force delete + re-mint\n"
  );

  command.action(async (name: string, options) =>
    runSetupEnv({ ...options, environmentName: name })
  );

  return command;
};
