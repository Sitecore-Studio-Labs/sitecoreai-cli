import { Command, Option } from "commander";
import {
  runDeployEnvironmentsList,
  runDeployEnvironmentsLimitation,
  runDeployEnvironmentsGet,
  runDeployEnvironmentsGetEdgeToken,
  runDeployEnvironmentsGetEditingSecret,
  runDeployEnvironmentsHealth,
} from "@/deploy/tasks/environments";
import { addDeployBaseOptions } from "../shared";

const parsePositiveInt =
  (label: string) =>
  (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
  };

export const createEnvironmentsListCommand = (): Command => {
  const environmentsList = new Command("list").description("List environments");
  addDeployBaseOptions(environmentsList);
  environmentsList
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--type <cm|eh>", "Filter by project type (cm or eh)"))
    .addOption(
      new Option(
        "--all",
        "Walk every page and return the consolidated result set (default). Pass --no-all (or --page) to fetch a single page."
      )
    )
    .addOption(
      new Option(
        "--page <n>",
        "1-based page number. Implies --no-all and fetches a single page."
      ).argParser(parsePositiveInt("--page"))
    )
    .addOption(
      new Option(
        "--page-size <n>",
        "Page size. Defaults to 50 when walking pages, otherwise the API default (10)."
      ).argParser(parsePositiveInt("--page-size"))
    );
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

export const createEnvironmentsHealthCommand = (): Command => {
  const environmentsHealth = new Command("health").description(
    "Probe environment health (GET <cmHost>/healthz/ready)"
  );
  addDeployBaseOptions(environmentsHealth);
  environmentsHealth
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsHealth.action(async (options) => runDeployEnvironmentsHealth(options));
  return environmentsHealth;
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
