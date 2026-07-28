import { Command } from "commander";
import { addConfigOption, addVerbosityOptions } from "./shared";
import { runStatus } from "@/setup/status";

export const createStatusCommand = (): Command => {
  const command = new Command("status").description(
    "Show configured Sitecore environments for this CLI"
  );

  addConfigOption(command);
  addVerbosityOptions(command);

  command.addHelpText("after", "\nExample:\n  $ scai setup status\n");

  command.action(async (options) => runStatus(options));

  return command;
};
