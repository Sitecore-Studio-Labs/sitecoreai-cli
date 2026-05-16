import { Command, Option } from "commander";
import { runPublishAll } from "@/publishing/tasks/all";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";

export const createPublishAllCommand = (): Command => {
  const command = new Command("all")
    .description(
      "Whole-environment republish to Edge (Tier 2). Publishes every item across every site in the environment — empirically verified against the API (the `xmc.site.mode` field is named for legacy XM reasons; there is no API surface to scope to a single site). To publish just one site's subtree, use `scai content publish item --site <name> --include-subitems`. MAXIMUM gating: always requires --confirm-token AND a typed env-name confirmation, regardless of whether the env is flagged production. Use sparingly — needed after big serialization pushes, rollbacks, or migrations where Edge has drifted from CM."
    )
    .option(
      "-l, --languages <list>",
      "Literal language list. Mutually exclusive with --languages-from-site / --all-tenant-languages.",
      (value: string) =>
        value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      [] as string[]
    )
    .option(
      "--languages-from-site <name>",
      "Resolve locales from the named site (Sites API). NOTE: the publish is still whole-environment — this flag scopes locales only, not items."
    )
    .option("--all-tenant-languages", "Resolve locales to every language registered in the tenant.")
    .addOption(
      new Option("--mode <mode>", "Whole-environment publish mode")
        .choices(["Republish", "Smart", "Incremental"])
        .default("Republish")
    )
    .option(
      "--confirm-token <token>",
      "Scope token from a previous dry-run. Always required for the real call."
    )
    .option("--yes", "Skip the typed env-name prompt (CI use). Still requires --confirm-token.")
    .option(
      "--no-wait",
      "In --non-interactive mode (default behavior is to watch), don't wait for the job to finish — submit and exit. The submitted jobId is logged so CI can poll later."
    )
    .addOption(
      new Option(
        "--poll-interval-s <seconds>",
        "Polling interval when watching in non-interactive mode (default 5, clamped to [2, 60])."
      ).argParser((v) => Number.parseInt(v, 10))
    )
    .addOption(
      new Option(
        "--timeout-s <seconds>",
        "Watch timeout in seconds when waiting on the job in non-interactive mode (default 1800)."
      ).argParser((v) => Number.parseInt(v, 10))
    )
    .addOption(new Option("--name <name>", "Override the API job name."))
    .addOption(new Option("--source <source>", "Override the API source field. Default `scai`."));

  addEnvironmentOption(command);
  addConfigOption(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nFlow (always two steps, no shortcut even on sandbox):\n" +
      "  1. Dry-run: scai content publish all -n <env>\n" +
      "     → prints scope summary + a 5-minute scope token\n" +
      "  2. Real call: scai content publish all -n <env> --allow-write --confirm-token <token>\n" +
      "     → prompts to type the env name verbatim (skippable with --yes for CI)\n"
  );

  command.action(async (options) => {
    await runPublishAll(options);
  });

  return command;
};
