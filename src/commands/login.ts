import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runDeployToken } from "../serialization/tasks/env/deploy-token";
import { createLoginBrandCommand } from "./setup-client";

/**
 * `scai setup login` — the one-time interactive device login that
 * mints a deploy token (the bootstrap credential). The token is used
 * to call the clients API and mint the automation client(s) via
 * `scai setup client create`; after that the automation client is
 * self-sufficient.
 *
 * `setup login brand` survives as a deprecated alias for
 * `scai setup client register-brand` — the canonical brand verb now
 * lives under `setup client`.
 */
export const createLoginCommand = (): Command => {
  const command = new Command("login").description(
    "Authenticate with SitecoreAI and store an access token (Deploy + CM/admin scopes)"
  );

  addEnvironmentOption(command);
  addConfigOption(command);
  // No `--non-interactive`: interactive login is a browser device flow
  // that cannot run headless, and the client-credentials path is
  // already non-interactive once --client-id/--client-secret are given.
  addVerbosityOptions(command, { nonInteractive: false });

  command
    .addOption(new Option("--client-id <id>", "SitecoreAI client ID"))
    .addOption(new Option("--client-secret <secret>", "SitecoreAI client secret"))
    .addOption(
      new Option("--use-client-credentials", "Use client credentials instead of interactive login")
    )
    .addOption(new Option("--print", "Print the access token to stdout"));

  command.addHelpText(
    "after",
    [
      "",
      "Two ways to authenticate:",
      "  • interactive (default) — a browser device flow; a human signs in.",
      "  • client credentials   — a machine credential (--use-client-credentials",
      "    with --client-id/--client-secret); no browser, for CI and agents.",
      "Both yield the same access token (it covers Deploy, CM/admin, and Brief).",
      "",
      "Examples:",
      "  $ scai setup login -n demo",
      "  $ scai setup login -n demo --use-client-credentials --client-id <id> --client-secret <secret>",
      "",
      "To register the brand credential, use `scai setup client register-brand`",
      "(`scai setup login brand` still works as a deprecated alias).",
      "",
    ].join("\n")
  );

  command.action(async (options) => runDeployToken(options));

  command.addCommand(createLoginBrandCommand());

  return command;
};
