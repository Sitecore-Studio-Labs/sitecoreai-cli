import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runInit } from "@/setup/init";

export const createInitCommand = (): Command => {
  const command = new Command("init").description(
    "Create or update an environment with project selection and SitecoreAI credentials"
  );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command
    .addOption(new Option("--cm, --host <url>", "Sitecore CM host (base URL)"))
    .addOption(new Option("--ref <name>", "Reference an existing environment for auth"))
    .addOption(new Option("--allow-write", "Allow write operations for this environment"))
    .addOption(new Option("--wizard", "Run the interactive setup wizard"))
    .addOption(
      new Option(
        "--skip-deploy-lookup",
        "Skip Deploy API lookups and prompt for the CM host directly"
      )
    )
    .addOption(
      new Option("--organization-id <id>", "Sitecore organization ID (written to the profile)")
    )
    .addOption(new Option("--tenant-id <id>", "Sitecore tenant ID (written to the profile)"))
    .addOption(
      new Option(
        "--deploy-organization <value>",
        "Organization name or ID for the Deploy API environment lookup"
      )
    )
    .addOption(new Option("--project <value>", "Project name or ID for the Deploy API lookup"))
    .addOption(
      new Option(
        "--deploy-environment <value>",
        "Environment name or ID for the Deploy API environment lookup"
      )
    )
    // Back-compat hidden aliases. The bare `--organization` / `--environment`
    // collided with `--organization-id` / `--environment-name`; the
    // `--deploy-*` spellings are the documented names. Old scripts keep working.
    .addOption(new Option("--organization <value>", "Alias of --deploy-organization.").hideHelp())
    .addOption(new Option("--environment <value>", "Alias of --deploy-environment.").hideHelp())
    .addOption(
      new Option("--deploy-token <token>", "SitecoreAI access token (Deploy + CM/admin scopes)")
    )
    .addOption(new Option("--client-id <id>", "SitecoreAI client ID"))
    .addOption(new Option("--client-secret <secret>", "SitecoreAI client secret"))
    .addOption(
      new Option("--use-client-credentials", "Use client credentials instead of interactive login")
    )
    .addOption(
      new Option(
        "--site <name>",
        "SXA Headless site name. Written to the profile so `scai provision recipe` derives recipeRoots automatically (no hand-written paths)."
      )
    )
    .addOption(
      new Option(
        "--site-collection <name>",
        "SXA Headless site collection (parent tenant). When omitted, scai tries to discover it from the environment's sites."
      )
    )
    .addOption(new Option("--set-default", "Set as default environment"));

  command.addHelpText(
    "after",
    [
      "",
      "Most setups should just run the wizard — it fills in everything below:",
      "  $ scai setup init --wizard",
      "",
      "For scripted (non-interactive) setup, the flags fall into groups:",
      "",
      "  Identify the environment — via the Deploy API:",
      "    --deploy-organization  --project  --deploy-environment",
      "  ...or skip the Deploy API and point at a CM host directly:",
      "    --cm <url>  --skip-deploy-lookup",
      "",
      "  Authentication — pick one:",
      "    --deploy-token <token>",
      "    --client-id <id>  --client-secret <secret>  --use-client-credentials",
      "",
      "  Identifiers written to the profile:",
      "    --organization-id  --tenant-id",
      "",
      "  Recipe authoring (optional) — set the SXA site so recipe commands",
      "  derive every recipeRoot automatically instead of hand-writing paths:",
      "    --site <name>  [--site-collection <name>]",
      "  Omit --site-collection to let scai discover it from the environment.",
      "",
      "Examples:",
      '  $ scai setup init -n demo --project "My Project" --deploy-environment "Dev"',
      "",
    ].join("\n")
  );

  // `--deploy-organization` / `--deploy-environment` are the documented
  // flags; `--organization` / `--environment` remain as hidden aliases.
  // The task layer (runInit) still reads `organization` / `environment`.
  command.action(async (options) =>
    runInit({
      ...options,
      organization: options.deployOrganization ?? options.organization,
      environment: options.deployEnvironment ?? options.environment,
    })
  );

  return command;
};
