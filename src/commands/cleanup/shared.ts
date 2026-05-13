import { Command } from "commander";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addForceOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";

export const addCleanupBaseOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  addForceOption(command);
  addVerbosityOptions(command);
  return command;
};
