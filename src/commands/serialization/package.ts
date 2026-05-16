import { Command } from "commander";
import {
  addConfigOption,
  addEnvironmentOption,
  addIncludeExcludeOptions,
  addPackageCreateOptions,
  addPackageInstallOptions,
  addPublishOptions,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";
import { runPackageCreate, runPackageInstall } from "../../serialization/tasks/package";

const createPackageCreateCommand = (): Command => {
  const command = new Command("create").description("Creates a new serialized item package");

  addPackageCreateOptions(command);
  addIncludeExcludeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runPackageCreate(options));

  return command;
};

const createPackageInstallCommand = (): Command => {
  const command = new Command("install").description(
    "Install an existing item package to Sitecore"
  );

  addPackageInstallOptions(command);
  addEnvironmentOption(command);
  addWhatIfOption(command);
  addIncludeExcludeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addPublishOptions(command);

  command.action(async (options) => runPackageInstall(options));

  return command;
};

export const createPackageCommand = (): Command => {
  const command = new Command("package")
    .description("Create or install packages of serialized items")
    .alias("pkg");

  command.addCommand(createPackageCreateCommand());
  command.addCommand(createPackageInstallCommand());

  return command;
};
