import { Command } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

/** Common option set for read-side `scai workflow *` commands. */
export const addWorkflowReadOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  return command;
};
