import { Command, Option } from "commander";
import {
  runDeployEnvironmentsDeploymentsList,
  runDeployEnvironmentsDeploymentsCreate,
} from "@/deploy/tasks/environments";
import { addDeployBaseOptions } from "../shared";

export const createEnvironmentsDeploymentsCommand = (): Command => {
  const environmentsDeployments = new Command("deployments").description("Environment deployments");

  const environmentsDeploymentsList = new Command("list").description(
    "List deployments for an environment"
  );
  addDeployBaseOptions(environmentsDeploymentsList);
  environmentsDeploymentsList
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsDeploymentsList.action(async (options) =>
    runDeployEnvironmentsDeploymentsList(options)
  );

  const environmentsDeploymentsCreate = new Command("create").description(
    "Deploy to an environment"
  );
  addDeployBaseOptions(environmentsDeploymentsCreate);
  environmentsDeploymentsCreate
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--redeploy", "Deploy using the existing linked source code"));
  environmentsDeploymentsCreate.action(async (options) =>
    runDeployEnvironmentsDeploymentsCreate(options)
  );

  environmentsDeployments.addCommand(environmentsDeploymentsCreate);
  environmentsDeployments.addCommand(environmentsDeploymentsList);

  return environmentsDeployments;
};
