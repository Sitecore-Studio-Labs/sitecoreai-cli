import { Command } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

export const addAuditBaseOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.option(
    "--index <name>",
    "Override the search index name (default: sitecore_master_index)"
  );
  command.option("--include-system", "Include /sitecore/system and platform items in the scan");
  command.option("--limit <count>", "Maximum number of items to inspect", (v) => parseInt(v, 10));
  return command;
};
