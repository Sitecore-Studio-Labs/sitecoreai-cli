import { Command, Option } from "commander";
import { addConfigOption, addVerbosityOptions } from "./shared";
import { runSetupEnv } from "../serialization/tasks/env/setup-env";
import { runSetupClients } from "../serialization/tasks/env/setup-clients";

/**
 * `scai setup client …` — manage an environment's CM automation
 * clients: the machine credentials scai uses to reach the Authoring
 * API. `create` mints one; `list` / `delete` manage what exists. They
 * are the create / list / delete faces of a single object — grouping
 * them under one `client` noun keeps that obvious.
 */
export const createSetupClientCommand = (): Command => {
  const command = new Command("client").description(
    "Manage an environment's CM automation clients — create, list, delete."
  );

  const create = new Command("create")
    .description(
      "Mint the CM automation client for an environment (idempotent — a no-op if one exists)."
    )
    .argument("<env>", "Environment profile name from sitecoreai.cli.json")
    .addOption(new Option("-w, --what-if", "Preview the action without minting or deleting."))
    .addOption(
      new Option("--rotate", "Delete and re-mint the client even if one is already provisioned.")
    );
  addConfigOption(create);
  addVerbosityOptions(create);
  create.action(async (env: string, options) => runSetupEnv({ ...options, environmentName: env }));

  const list = new Command("list")
    .description("List the automation clients in an environment's organization.")
    .argument("[env]", "Environment profile name (defaults to the configured default).");
  addConfigOption(list);
  addVerbosityOptions(list);
  list.action(async (env: string | undefined, options) =>
    runSetupClients({ ...options, environmentName: env })
  );

  const remove = new Command("delete")
    .description("Delete one automation client from an environment's organization.")
    .argument("<id>", "Client id to delete.")
    .argument("[env]", "Environment profile name (defaults to the configured default).")
    .addOption(new Option("-f, --force", "Skip the delete confirmation prompt."));
  addConfigOption(remove);
  addVerbosityOptions(remove);
  remove.action(async (id: string, env: string | undefined, options) =>
    runSetupClients({ ...options, environmentName: env, delete: id })
  );

  command.addCommand(create);
  command.addCommand(list);
  command.addCommand(remove);

  command.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ scai setup client create production           # mint the CM client",
      "  $ scai setup client create production --rotate   # force delete + re-mint",
      "  $ scai setup client list                         # clients in the default env's org",
      "  $ scai setup client list production",
      "  $ scai setup client delete <id> --force",
      "",
    ].join("\n")
  );

  return command;
};
