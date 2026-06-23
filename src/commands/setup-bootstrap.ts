import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runBootstrap } from "../serialization/tasks/env/bootstrap";

/**
 * `scai setup bootstrap [env]` — the one-command path from a configured env
 * profile to a pushable recipe set: workspace-policy grants (consent-gated),
 * device login, CM automation client, SXA site picker, and an optional recipe
 * push. Every step is idempotent, so it also works as a "fix my setup" command.
 *
 * Prerequisite: the env profile must already exist (`scai setup init`).
 */
export const createBootstrapCommand = (): Command => {
  const command = new Command("bootstrap")
    .description(
      "Guided setup: policy + login + CM client + site + recipe push for an environment."
    )
    .argument("[env]", "Environment profile name (defaults to the configured default env).");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command
    .addOption(
      new Option("--yes", "Accept every consent prompt (policy grants, login, push) — for CI.")
    )
    .addOption(new Option("--skip-push", "Provision only — do not push the recipe set at the end."))
    .addOption(
      new Option(
        "--prune-defaults",
        "After pushing, prune the SXA Headless OOTB default folders (Media, Navigation, Promo, …)."
      )
    );

  command.addHelpText(
    "after",
    [
      "",
      "Runs, in order (each step idempotent, policy + login + push consent-gated):",
      "  1. policy   — enroll + permit minting + raise ceiling to 'destructive'",
      "  2. login    — device login (mints the deploy token)",
      "  3. client   — mint the env-scoped CM automation client",
      "  4. site     — pick the SXA site → writes site/siteCollection (roots derive)",
      "  5. push     — apply the recipe set (skip with --skip-push)",
      "  6. prune    — remove SXA OOTB default folders (only with --prune-defaults)",
      "",
      "Prerequisite: the env profile must exist — run 'scai setup init' first.",
      "",
      "Examples:",
      "  $ scai setup bootstrap Sodra",
      "  $ scai setup bootstrap Sodra --yes --skip-push",
      "",
    ].join("\n")
  );

  command.action(async (env: string | undefined, options) =>
    runBootstrap({ ...options, environmentName: options.environmentName ?? env })
  );

  return command;
};
