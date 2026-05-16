import { Command } from "commander";
import {
  addApplyOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";

export const addDeployBaseOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addWhatIfOption(command);
  addApplyOption(command);
  addVerbosityOptions(command);
  return command;
};
