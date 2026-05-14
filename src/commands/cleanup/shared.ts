import { Command } from "commander";
import {
  addAllowWriteOption,
  addApplyOption,
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
  addApplyOption(command);
  addAllowWriteOption(command);
  addForceOption(command);
  addVerbosityOptions(command);
  return command;
};
