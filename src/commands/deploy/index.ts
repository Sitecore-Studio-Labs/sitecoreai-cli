import { Command } from "commander";
import { createDeployOrganizationsCommand } from "./organizations";
import { createDeployProjectsCommand } from "./projects";
import { createDeployEnvironmentsCommand } from "./environments";
import { createDeploySourceControlCommand } from "./source-control";
import { createDeployDeploymentsCommand } from "./deployments";
import { createDeployLogsCommand } from "./logs";
import { createDeployEditingHostCommand } from "./editing-host";
import { createDeploySiteCommand } from "./site";
import { createDeployBuildConfigCommand } from "./build-config";
import { createDeployEnvFileCommand } from "./env-file";

export const createDeployCommand = (): Command => {
  const command = new Command("deploy").description("XM Cloud Deploy API commands");

  command.addCommand(createDeployBuildConfigCommand());
  command.addCommand(createDeployEnvFileCommand());
  command.addCommand(createDeployDeploymentsCommand());
  command.addCommand(createDeployEditingHostCommand());
  command.addCommand(createDeployEnvironmentsCommand());
  command.addCommand(createDeployLogsCommand());
  command.addCommand(createDeployOrganizationsCommand());
  command.addCommand(createDeployProjectsCommand());
  command.addCommand(createDeploySiteCommand());
  command.addCommand(createDeploySourceControlCommand());

  command.addHelpText(
    "after",
    '\nExamples:\n  $ scai provision deploy projects list\n  $ scai provision deploy environments list --project "My Project" --type cm\n  $ scai provision deploy site list --environment-name myenv --hostnames\n'
  );

  return command;
};
