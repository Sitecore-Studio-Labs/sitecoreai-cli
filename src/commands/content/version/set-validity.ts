import { Command } from "commander";
import { runContentVersionSetValidity } from "@/content/tasks/version-validity";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../../shared";

export const createSetValidityCommand = (): Command => {
  const command = new Command("set-validity")
    .description(
      "Set or clear `__Valid from` / `__Valid to` on a specific item version. Pure CM mutation — does NOT auto-publish. Run `scai publish item` afterwards to push the change to Edge."
    )
    .option("--item-id <guid>", "Target item ID (GUID). Mutually exclusive with --path.")
    .option("--path <path>", "Target item path. Mutually exclusive with --item-id.")
    .option("--language <code>", "Sitecore language code (e.g. en, en-US, fr-CA).")
    .option(
      "--version <n>",
      "Specific version number (1-indexed). Defaults to the latest.",
      (raw) => Number.parseInt(raw, 10)
    )
    .option(
      "--valid-from <iso8601>",
      "Set `__Valid from`. ISO 8601 e.g. 2026-12-31 or 2026-12-31T23:59:59Z."
    )
    .option("--clear-valid-from", "Clear `__Valid from` (write empty string).")
    .option(
      "--valid-to <iso8601>",
      "Set `__Valid to`. ISO 8601 e.g. 2026-12-31 or 2026-12-31T23:59:59Z."
    )
    .option("--clear-valid-to", "Clear `__Valid to` (write empty string).")
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
    await runContentVersionSetValidity(options);
  });
  return command;
};
