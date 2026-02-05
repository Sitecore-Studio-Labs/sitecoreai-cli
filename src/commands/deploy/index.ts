import { Command } from "commander";
import { createDeployOrganizationsCommand } from "./organizations";
import { createDeployProjectsCommand } from "./projects";
import { createDeployEnvironmentsCommand } from "./environments";
import { createDeploySourceControlCommand } from "./source-control";
import { createDeployDeploymentsCommand } from "./deployments";
import { createDeployLogsCommand } from "./logs";
import { createDeployEditingHostCommand } from "./editing-host";

export const createDeployCommand = (): Command => {
  const command = new Command("deploy").description("XM Cloud Deploy API commands");

  command.addCommand(createDeployDeploymentsCommand());
  command.addCommand(createDeployEditingHostCommand());
  command.addCommand(createDeployEnvironmentsCommand());
  command.addCommand(createDeployLogsCommand());
  command.addCommand(createDeployOrganizationsCommand());
  command.addCommand(createDeployProjectsCommand());
  command.addCommand(createDeploySourceControlCommand());

  command.addHelpText(
    "after",
    '\nExamples:\n  $ scai deploy projects list\n  $ scai deploy environments list --project "My Project" --type cm\n'
  );

  return command;
};
