import { Command, Option } from "commander";
import {
  runDeployEnvironmentsList,
  runDeployEnvironmentsLimitation,
  runDeployEnvironmentsGet,
  runDeployEnvironmentsGetEdgeToken,
  runDeployEnvironmentsGetEditingSecret,
} from "@/deploy/tasks";
import { addDeployBaseOptions } from "../shared";

export const createEnvironmentsListCommand = (): Command => {
  const environmentsList = new Command("list").description("List environments");
  addDeployBaseOptions(environmentsList);
  environmentsList
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--type <cm|eh>", "Filter by project type (cm or eh)"));
  environmentsList.action(async (options) => runDeployEnvironmentsList(options));
  return environmentsList;
};

export const createEnvironmentsLimitationCommand = (): Command => {
  const environmentsLimitation = new Command("limitation").description(
    "Get environment limitations"
  );
  addDeployBaseOptions(environmentsLimitation);
  environmentsLimitation.action(async (options) => runDeployEnvironmentsLimitation(options));
  return environmentsLimitation;
};

export const createEnvironmentsGetCommand = (): Command => {
  const environmentsGet = new Command("get").description("Get an environment by name or ID");
  addDeployBaseOptions(environmentsGet);
  environmentsGet
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsGet.action(async (options) => runDeployEnvironmentsGet(options));
  return environmentsGet;
};

export const createEnvironmentsGetEdgeTokenCommand = (): Command => {
  const environmentsGetEdgeToken = new Command("get-edge-token").description(
    "Get edge token for an environment"
  );
  addDeployBaseOptions(environmentsGetEdgeToken);
  environmentsGetEdgeToken
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsGetEdgeToken.action(async (options) => runDeployEnvironmentsGetEdgeToken(options));
  return environmentsGetEdgeToken;
};

export const createEnvironmentsGetEditingSecretCommand = (): Command => {
  const environmentsGetEditingSecret = new Command("get-editing-secret").description(
    "Get editing secret for an environment"
  );
  addDeployBaseOptions(environmentsGetEditingSecret);
  environmentsGetEditingSecret
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsGetEditingSecret.action(async (options) =>
    runDeployEnvironmentsGetEditingSecret(options)
  );
  return environmentsGetEditingSecret;
};
