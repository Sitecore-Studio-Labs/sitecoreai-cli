import { Command } from "commander";
import {
  createEnvironmentsListCommand,
  createEnvironmentsLimitationCommand,
  createEnvironmentsGetCommand,
  createEnvironmentsGetEdgeTokenCommand,
  createEnvironmentsGetEditingSecretCommand,
} from "./queries";
import { createEnvironmentsVariablesCommand } from "./variables";
import { createEnvironmentsDeploymentsCommand } from "./deployments";
import {
  createEnvironmentsCreateCommand,
  createEnvironmentsRegenerateContextCommand,
  createEnvironmentsPromoteCommand,
  createEnvironmentsRestartCommand,
  createEnvironmentsLinkRepositoryCommand,
  createEnvironmentsUnlinkRepositoryCommand,
  createEnvironmentsDeleteCommand,
} from "./mutations";

export const createDeployEnvironmentsCommand = (): Command => {
  const environments = new Command("environments")
    .description("Environment operations")
    .alias("env");

  environments.addCommand(createEnvironmentsCreateCommand());
  environments.addCommand(createEnvironmentsDeleteCommand());
  environments.addCommand(createEnvironmentsDeploymentsCommand());
  environments.addCommand(createEnvironmentsGetCommand());
  environments.addCommand(createEnvironmentsGetEdgeTokenCommand());
  environments.addCommand(createEnvironmentsGetEditingSecretCommand());
  environments.addCommand(createEnvironmentsLimitationCommand());
  environments.addCommand(createEnvironmentsLinkRepositoryCommand());
  environments.addCommand(createEnvironmentsListCommand());
  environments.addCommand(createEnvironmentsPromoteCommand());
  environments.addCommand(createEnvironmentsRegenerateContextCommand());
  environments.addCommand(createEnvironmentsRestartCommand());
  environments.addCommand(createEnvironmentsUnlinkRepositoryCommand());
  environments.addCommand(createEnvironmentsVariablesCommand());

  return environments;
};
