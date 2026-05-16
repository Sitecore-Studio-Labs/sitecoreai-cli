import { Command, Option } from "commander";
import { runContentVersionSetNeverPublish } from "@/content/tasks/version-never-publish";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../../shared";

const parseBoolFlag = (raw: string): boolean => {
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  throw new Error(`--value must be true or false (got '${raw}').`);
};

export const createSetNeverPublishCommand = (): Command => {
  const command = new Command("set-never-publish")
    .description(
      "Set or clear `__Never publish` on a specific item version. Pure CM mutation — does NOT auto-publish. Run `scai content publish item` afterwards to push the change to Edge."
    )
    .option("--item-id <guid>", "Target item ID (GUID). Mutually exclusive with --path.")
    .option("--path <path>", "Target item path. Mutually exclusive with --item-id.")
    .option("--language <code>", "Sitecore language code (e.g. en, en-US, fr-CA).")
    .option(
      "--version <n>",
      "Specific version number (1-indexed). Defaults to the latest.",
      (raw) => Number.parseInt(raw, 10)
    )
    .addOption(
      new Option(
        "--value <bool>",
        "Target value for `__Never publish`. `true` skips the item on the next publish; `false` allows it to publish again."
      )
        .choices(["true", "false"])
        .makeOptionMandatory(true)
    )
    .option(
      "--confirm-token <token>",
      "Scope token obtained from a previous dry-run. Required on production-tier envs."
    )
    .option("--yes", "Skip the [y/N] prompt on non-production envs.");

  addEnvironmentOption(command);
  addConfigOption(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runContentVersionSetNeverPublish({
      ...options,
      value: parseBoolFlag(options.value as string),
    });
  });
  return command;
};
