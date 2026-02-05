import { Command } from "commander";
import {
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";

export const addDeployBaseOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addWhatIfOption(command);
  addVerbosityOptions(command);
  return command;
};
