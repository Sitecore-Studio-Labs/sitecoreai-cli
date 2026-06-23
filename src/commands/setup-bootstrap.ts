import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runBootstrap } from "../serialization/tasks/env/bootstrap";

/**
 * `scai setup bootstrap [env]` — the one-command path from (optionally) nothing
 * to a working head app: runs `setup init` if no profile exists yet, then
 * workspace-policy grants (consent-gated), device login, CM automation client,
 * SXA site picker, head-app repo assets (.env.local + xmcloud.build.json), and
 * an optional recipe push. Every step is idempotent, so it also works as a
 * "fix my setup" command.
 */
export const createBootstrapCommand = (): Command => {
  const command = new Command("bootstrap")
    .description(
      "Guided setup: init (if needed) + policy + login + CM client + site + repo assets + recipe push."
    )
    .argument("[env]", "Environment profile name (defaults to the configured default env).");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command
    .addOption(
      new Option(
        "--yes",
        "Accept every consent prompt (policy grants, login, assets, push) — for CI."
      )
    )
    .addOption(
      new Option("--assets", "Generate repo assets even outside a detected head-app repo.")
    )
    .addOption(
      new Option("--skip-assets", "Skip the repo-assets step (.env.local + xmcloud.build.json).")
    )
    .addOption(
      new Option(
        "--rendering-host <name>",
        "Rendering-host key for xmcloud.build.json (default: <site>-editing-host)."
      )
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
      "Runs, in order (each step idempotent; consent-gated unless --yes):",
      "  0. init     — run 'setup init' first if no profile exists yet",
      "  1. policy   — enroll + permit minting + raise ceiling to 'destructive'",
      "  2. login    — device login (mints the deploy token)",
      "  3. client   — mint the env-scoped CM automation client",
      "  4. site     — pick the SXA site → writes site/siteCollection (roots derive)",
      "  5. assets   — write .env.local + xmcloud.build.json (auto in a head-app repo)",
      "  6. push     — apply the recipe set (skip with --skip-push)",
      "  7. prune    — remove SXA OOTB default folders (only with --prune-defaults)",
      "",
      "Examples:",
      "  $ scai setup bootstrap Sodra                  # full run (init if needed)",
      "  $ scai setup bootstrap Sodra --yes --skip-push  # provision only, no recipes",
      "  $ scai setup bootstrap Sodra --skip-assets      # don't touch repo files",
      "",
    ].join("\n")
  );

  command.action(async (env: string | undefined, options) =>
    runBootstrap({ ...options, environmentName: options.environmentName ?? env })
  );

  return command;
};
