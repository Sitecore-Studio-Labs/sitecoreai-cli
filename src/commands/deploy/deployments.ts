import { Command, Option } from "commander";
import {
  runDeployDeploymentsList,
  runDeployDeploymentsGet,
  runDeployDeploymentsStatus,
  runDeployDeploymentsDeploy,
  runDeployDeploymentsCancel,
  runDeployDeploymentsSource,
  runDeployDeploymentsWatch,
  runDeployDeploymentLogs,
} from "@/deploy/tasks/deployments";
import { addDeployBaseOptions } from "./shared";

export const createDeployDeploymentsCommand = (): Command => {
  const deployments = new Command("deployments").description("Deployment operations").alias("dep");

  const deploymentsList = new Command("list").description("List deployments");
  addDeployBaseOptions(deploymentsList);
  deploymentsList.addOption(new Option("--status <status>", "Filter by deployment status"));
  deploymentsList.action(async (options) => runDeployDeploymentsList(options));

  const deploymentsGet = new Command("get").description("Get a deployment by ID");
  addDeployBaseOptions(deploymentsGet);
  deploymentsGet.addOption(new Option("--id <id>", "Deployment ID"));
  deploymentsGet.action(async (options) => runDeployDeploymentsGet(options));

  const deploymentsStatus = new Command("status").description(
    "Get deployment counts grouped by status"
  );
  addDeployBaseOptions(deploymentsStatus);
  deploymentsStatus.action(async (options) => runDeployDeploymentsStatus(options));

  const deploymentsDeploy = new Command("deploy").description("Start a deployment");
  addDeployBaseOptions(deploymentsDeploy);
  deploymentsDeploy.addOption(new Option("--id <id>", "Deployment ID"));
  deploymentsDeploy.action(async (options) => runDeployDeploymentsDeploy(options));

  const deploymentsCancel = new Command("cancel").description("Cancel a deployment");
  addDeployBaseOptions(deploymentsCancel);
  deploymentsCancel.addOption(new Option("--id <id>", "Deployment ID"));
  deploymentsCancel.action(async (options) => runDeployDeploymentsCancel(options));

  const deploymentsSource = new Command("source").description("Upload deployment source");
  addDeployBaseOptions(deploymentsSource);
  deploymentsSource
    .addOption(new Option("--id <id>", "Deployment ID"))
    .addOption(new Option("--file <path>", "Path to source archive"))
    .addOption(new Option("--directory <path>", "Directory to zip and upload"));
  deploymentsSource.action(async (options) => runDeployDeploymentsSource(options));

  const deploymentsWatch = new Command("watch").description("Watch deployment status");
  addDeployBaseOptions(deploymentsWatch);
  deploymentsWatch
    .addOption(new Option("--id <id>", "Deployment ID"))
    .addOption(new Option("--wait-for-post-actions", "Wait for post-actions to complete"))
    .addOption(
      new Option("--timeout <seconds>", "Timeout in seconds before exiting watch").argParser(Number)
    );
  deploymentsWatch.action(async (options) => runDeployDeploymentsWatch(options));

  const deploymentsLogs = new Command("logs").description("Get deployment logs");
  addDeployBaseOptions(deploymentsLogs);
  deploymentsLogs
    .addOption(new Option("--id <id>", "Deployment ID"))
    .addOption(new Option("--output <path>", "Output file path"));
  deploymentsLogs.action(async (options) => runDeployDeploymentLogs(options));

  deployments.addCommand(deploymentsCancel);
  deployments.addCommand(deploymentsDeploy);
  deployments.addCommand(deploymentsGet);
  deployments.addCommand(deploymentsList);
  deployments.addCommand(deploymentsLogs);
  deployments.addCommand(deploymentsSource);
  deployments.addCommand(deploymentsStatus);
  deployments.addCommand(deploymentsWatch);

  return deployments;
};
