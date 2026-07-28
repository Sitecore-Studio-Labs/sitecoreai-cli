import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runSetupEnv } from "@/serialization/tasks/env/setup-env";
import { runSetupOrgClient } from "@/serialization/tasks/env/setup-org-client";
import { runSetupClients } from "@/serialization/tasks/env/setup-clients";
import { runBrandLogin } from "@/brand/tasks/login";

/**
 * `scai setup client register-brand` — register a Sitecore AI APIs key
 * for the active environment's organization (the credential `scai brand`
 * uses).
 *
 * Brand is one of scai's two credential kinds (see `docs/credentials.md`).
 * Unlike the automation client, the AI APIs key is **not minted** by
 * scai — the operator creates it in Cloud Portal → Stream → Admin → AI
 * APIs keys and *registers* it here. Hence `register-brand`, not
 * `create`: there is no browser flow and nothing is minted. You paste
 * (or are prompted for) the key's Client ID and Client Secret, scai
 * validates it by minting a test token, and stores it — `clientId` /
 * `authority` / `audience` into the `brand[orgId]` config block, the
 * secret into the OS keychain.
 *
 * The AI APIs key is org-scoped (one-org-per-credential) and carries
 * `ai.org.*` scopes; the automation client cannot do brand work, hence
 * the separate credential. It lives under `setup client` because that
 * is the single command surface for both of scai's credential kinds.
 *
 * `setup login brand` stays as a deprecated alias so existing scripts
 * keep working.
 */
const configureBrandCommand = (command: Command): Command => {
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

  command.action(async (options) => runBrandLogin(options));

  return command;
};

/**
 * `scai setup client register-brand` — the canonical brand verb,
 * grouped under `setup client` alongside the automation-client verbs.
 */
const createRegisterBrandCommand = (): Command => {
  const command = new Command("register-brand")
    .aliases(["brand"])
    .description(
      "Register a Sitecore AI APIs key (the brand credential) for the org behind the active environment — powers `scai brand`. Credential registration, not minting."
    );

  configureBrandCommand(command);

  command.addHelpText(
    "after",
    [
      "",
      "Registers an AI APIs key — it never opens a browser and never mints.",
      "The AI APIs key is the brand credential: a separate credential from the",
      "automation client minted by `scai setup client create`. The automation",
      "client cannot do brand work, so brand gets its own verb.",
      "",
      "Create the key in Cloud Portal → Stream → Admin → AI APIs keys, then:",
      "  $ scai setup client register-brand -n sandbox",
      "  $ scai setup client register-brand --org-id org_xxx --client-id <id> --client-secret <secret>",
      "",
    ].join("\n")
  );

  return command;
};

/**
 * `scai setup login brand` — deprecated alias for
 * `scai setup client register-brand`. Behavior is identical; kept so
 * scripts written against the old command surface keep working.
 */
export const createLoginBrandCommand = (): Command => {
  const command = new Command("brand")
    .aliases(["ai-skills", "ai-skill", "aiskills", "aiskill"])
    .description(
      "Deprecated alias for `scai setup client register-brand` — register an AI APIs key (the brand credential)."
    );

  configureBrandCommand(command);

  command.addHelpText(
    "after",
    [
      "",
      "Deprecated: use `scai setup client register-brand` instead. This alias",
      "stays for back-compat and behaves identically.",
      "",
      "Create the key in Cloud Portal → Stream → Admin → AI APIs keys, then:",
      "  $ scai setup client register-brand -n sandbox",
      "",
    ].join("\n")
  );

  return command;
};

/**
 * `scai setup client …` — manage an environment's credentials. The
 * `create` / `list` / `delete` verbs operate on the automation client
 * (the machine credential scai mints and uses for Deploy, Authoring,
 * Publishing, Sites, Pages, Brief, and Campaign); `register-brand`
 * registers the brand / AI APIs key. Grouping both of scai's credential
 * kinds under one `client` noun keeps the credential surface in one
 * place.
 */
export const createSetupClientCommand = (): Command => {
  const command = new Command("client").description(
    "Manage an environment's credentials — automation clients (create, list, delete) and the brand key (register-brand)."
  );

  const create = new Command("create")
    .description(
      "Mint an automation client — env-scoped by default, org-scoped with --org (idempotent)."
    )
    .argument(
      "[env]",
      "Environment profile name (defaults to the configured default env; with --org, only used to resolve the organization)."
    )
    .addOption(
      new Option(
        "--org",
        "Mint the organization-scoped automation client (shared by every env in the org) instead of the env-scoped one."
      )
    )
    .addOption(new Option("-w, --what-if", "Preview the action without minting or deleting."))
    .addOption(
      new Option("--rotate", "Delete and re-mint the client even if one is already provisioned.")
    );
  addConfigOption(create);
  addVerbosityOptions(create);
  create.action(async (env: string | undefined, options) =>
    options.org
      ? runSetupOrgClient({ ...options, environmentName: env })
      : runSetupEnv({ ...options, environmentName: env })
  );

  const list = new Command("list")
    .description("List the automation clients in an environment's organization.")
    .argument("[env]", "Environment profile name (defaults to the configured default).");
  addConfigOption(list);
  addVerbosityOptions(list);
  list.action(async (env: string | undefined, options) =>
    runSetupClients({ ...options, environmentName: env })
  );

  const remove = new Command("delete")
    .description("Delete one automation client from an environment's organization.")
    .argument("<id>", "Client id to delete.")
    .argument("[env]", "Environment profile name (defaults to the configured default).")
    .addOption(new Option("-f, --force", "Skip the delete confirmation prompt."));
  addConfigOption(remove);
  addVerbosityOptions(remove);
  remove.action(async (id: string, env: string | undefined, options) =>
    runSetupClients({ ...options, environmentName: env, delete: id })
  );

  command.addCommand(create);
  command.addCommand(list);
  command.addCommand(remove);
  command.addCommand(createRegisterBrandCommand());

  command.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ scai setup client create                       # CM client for the default env",
      "  $ scai setup client create production            # mint the CM automation client",
      "  $ scai setup client create --org                 # org client for the default env's org",
      "  $ scai setup client create production --org      # mint the org-scoped automation client",
      "  $ scai setup client create production --rotate   # force delete + re-mint",
      "  $ scai setup client list                         # clients in the default env's org",
      "  $ scai setup client list production",
      "  $ scai setup client delete <id> --force",
      "  $ scai setup client register-brand production    # register the brand / AI APIs key",
      "",
    ].join("\n")
  );

  return command;
};
