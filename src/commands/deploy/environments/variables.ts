import { Command, Option } from "commander";
import {
  runDeployEnvironmentsVariablesList,
  runDeployEnvironmentsVariablesCreate,
  runDeployEnvironmentsVariablesDelete,
} from "@/deploy/tasks";
import { addDeployBaseOptions } from "../shared";

export const createEnvironmentsVariablesCommand = (): Command => {
  const environmentsVariables = new Command("variables").description("Environment variables");

  const environmentsVariablesList = new Command("list").description("List environment variables");
  addDeployBaseOptions(environmentsVariablesList);
  environmentsVariablesList
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsVariablesList.action(async (options) => runDeployEnvironmentsVariablesList(options));

  const environmentsVariablesCreate = new Command("create").description(
    "Create or update an environment variable"
  );
  addDeployBaseOptions(environmentsVariablesCreate);
  environmentsVariablesCreate
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--variable <name>", "Variable name"))
    .addOption(new Option("--value <value>", "Variable value"))
    .addOption(new Option("--target <value>", "Variable target"))
    .addOption(new Option("--secret", "Store the variable as secret"));
  environmentsVariablesCreate.action(async (options) =>
    runDeployEnvironmentsVariablesCreate(options)
  );

  const environmentsVariablesDelete = new Command("delete").description(
    "Delete an environment variable"
  );
  addDeployBaseOptions(environmentsVariablesDelete);
  environmentsVariablesDelete
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--variable <name>", "Variable name"));
  environmentsVariablesDelete.action(async (options) =>
    runDeployEnvironmentsVariablesDelete(options)
  );

  environmentsVariables.addCommand(environmentsVariablesCreate);
  environmentsVariables.addCommand(environmentsVariablesDelete);
  environmentsVariables.addCommand(environmentsVariablesList);

  return environmentsVariables;
};
