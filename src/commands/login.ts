import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runDeployToken } from "../serialization/tasks/env/deploy-token";
import { runBrandLogin } from "../brand/tasks/login";

/**
 * `scai setup login brand` — store a Sitecore AI APIs key for the
 * active environment's organization (the credential `scai brand` uses).
 *
 * This is credential *provisioning*, not an interactive login: there
 * is no browser flow. You paste (or are prompted for) the Client ID
 * and Client Secret of an "AI APIs key" created at Cloud Portal →
 * Stream → Admin → AI APIs keys, scai validates it by minting a test
 * token, and stores it. AI APIs keys are a different credential class
 * from the env automation client — org-scoped (one-org-per-credential),
 * carrying `ai.org.*` scopes — so they live in a separate
 * `brand[orgId]` config block. The env automation client (Deploy /
 * CM / Brief / Campaign) cannot do brand work, hence the separate
 * credential.
 *
 * Named `brand` because that is exactly — and only — what it powers.
 * `ai-skills` (the former name, matching Sitecore's product taxonomy)
 * stays as a command alias.
 */
const createLoginBrandCommand = (): Command => {
  const command = new Command("brand")
    .aliases(["ai-skills", "ai-skill", "aiskills", "aiskill"])
    .description(
      "Store an AI APIs key (a client credential) for the org behind the active environment — powers `scai brand`. Credential provisioning, not an interactive login."
    );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command, { nonInteractive: false });

  command
    .addOption(
      new Option(
        "--org-id <id>",
        "Sitecore organizationId to bind the credential to. Defaults to the env profile's organizationId."
      )
    )
    .addOption(new Option("--client-id <id>", "AI APIs key Client ID"))
    .addOption(new Option("--client-secret <secret>", "AI APIs key Client Secret"))
    .addOption(
      new Option("--authority <url>", "OAuth authority. Defaults to https://auth.sitecorecloud.io.")
    )
    .addOption(
      new Option("--audience <url>", "OAuth audience. Defaults to https://api.sitecorecloud.io.")
    )
    .addOption(
      new Option("--force", "Overwrite an existing credential for this org without prompting")
    );

  command.addHelpText(
    "after",
    [
      "",
      "This stores a client credential — it never opens a browser. An AI APIs",
      "key is a separate credential from the env automation client that",
      "`scai setup login` provisions; the automation client cannot do brand",
      "work, so this is its own command.",
      "",
      "Create the key in Cloud Portal → Stream → Admin → AI APIs keys, then:",
      "  $ scai setup login brand -n sandbox",
      "  $ scai setup login brand --org-id org_xxx --client-id <id> --client-secret <secret>",
      "",
      "(`ai-skills` still works as an alias for this command.)",
      "",
    ].join("\n")
  );

  command.action(async (options) => runBrandLogin(options));

  return command;
};

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
      "  $ scai setup login brand -n demo   (store an AI APIs key — separate credential)",
      "",
    ].join("\n")
  );

  command.action(async (options) => runDeployToken(options));

  command.addCommand(createLoginBrandCommand());

  return command;
};
