import { Command } from "commander";
import {
  addConfigOption,
  addDiffOptions,
  addEnvironmentOption,
  addExplainOptions,
  addAllowWriteOption,
  addForceOption,
  addIncludeExcludeOptions,
  addValidateOptions,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";
import { createPackageCommand } from "./package";
import { runDiff } from "../../serialization/tasks/diff";
import { runExplain, runInfo } from "../../serialization/tasks/info";
import { runPull } from "../../serialization/tasks/pull";
import { runPush } from "../../serialization/tasks/push";
import { runValidate } from "../../serialization/tasks/validate";
import { runWatch } from "../../serialization/tasks/watch";

const createInfoCommand = (): Command => {
  const command = new Command("info").description("Shows serialization configuration information");

  addIncludeExcludeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runInfo(options));

  return command;
};

const createExplainCommand = (): Command => {
  const command = new Command("explain").description(
    "Explains whether an item path is included and why"
  );

  addExplainOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runExplain(options));

  return command;
};

const createPullCommand = (): Command => {
  const command = new Command("pull").description("Pulls serialized items from Sitecore to disk");

  addEnvironmentOption(command);
  addIncludeExcludeOptions(command);
  addWhatIfOption(command);
  addForceOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runPull(options));

  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push").description(
    "Pushes serialized items from disk into Sitecore"
  );

  addEnvironmentOption(command);
  addIncludeExcludeOptions(command);
  addWhatIfOption(command);
  addForceOption(command);
  addAllowWriteOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runPush(options));

  return command;
};

const createDiffCommand = (): Command => {
  const command = new Command("diff").description("Compares two Sitecore instances");

  addDiffOptions(command);
  addIncludeExcludeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runDiff(options));

  return command;
};

const createValidateCommand = (): Command => {
  const command = new Command("validate").description(
    "Checks serialized items for validity and can fix common issues"
  );

  addIncludeExcludeOptions(command);
  addValidateOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runValidate(options));

  return command;
};

const createWatchCommand = (): Command => {
  const command = new Command("watch").description(
    "Watches item changes in Sitecore and pulls them to disk"
  );

  addEnvironmentOption(command);
  addIncludeExcludeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runWatch(options));

  return command;
};

export const createSerializationCommand = (): Command => {
  const command = new Command("serialization")
    .description("Item serialization commands")
    .alias("ser");

  command.addCommand(createDiffCommand());
  command.addCommand(createExplainCommand());
  command.addCommand(createInfoCommand());
  command.addCommand(createPackageCommand());
  command.addCommand(createPullCommand());
  command.addCommand(createPushCommand());
  command.addCommand(createValidateCommand());
  command.addCommand(createWatchCommand());

  command.addHelpText(
    "after",
    "\nAlias: ser\nExamples:\n  $ scai provision serialization pull -n demo\n  $ scai provision ser diff -s demo -d prod\n"
  );

  return command;
};
