import { Command } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const addWebhookReadOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  return command;
};
