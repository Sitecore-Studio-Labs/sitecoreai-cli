import { Command } from "commander";
import { runContentVersionGet } from "@/content/tasks/version-get";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../../shared";

export const createContentVersionGetCommand = (): Command => {
  const command = new Command("get")
    .description(
      "Print the publish-state fields (`__Never publish`, `__Valid from`, `__Valid to`) and the rest of the field list for an item version. Read-only — no audit-log write."
    )
    .option("--item-id <guid>", "Target item ID (GUID). Mutually exclusive with --path.")
    .option("--path <path>", "Target item path. Mutually exclusive with --item-id.")
    .option("--language <code>", "Sitecore language code (e.g. en, en-US, fr-CA).")
    .option(
      "--version <n>",
      "Specific version number (1-indexed). Defaults to the latest.",
      (raw) => Number.parseInt(raw, 10)
    );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runContentVersionGet(options);
  });
  return command;
};
