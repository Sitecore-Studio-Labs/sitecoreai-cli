import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runInit } from "../serialization/tasks/env/init";

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
    .addOption(new Option("--organization-id <id>", "Sitecore organization ID"))
    .addOption(new Option("--tenant-id <id>", "Sitecore tenant ID"))
    .addOption(new Option("--organization <name>", "Organization name or ID (Deploy API)"))
    .addOption(new Option("--project <value>", "Project name or ID (Deploy API)"))
    .addOption(new Option("--environment <value>", "Environment name or ID (Deploy API)"))
    .addOption(
      new Option("--deploy-token <token>", "SitecoreAI access token (Deploy + CM/admin scopes)")
    )
    .addOption(new Option("--client-id <id>", "SitecoreAI client ID"))
    .addOption(new Option("--client-secret <secret>", "SitecoreAI client secret"))
    .addOption(
      new Option("--use-client-credentials", "Use client credentials instead of interactive login")
    )
    .addOption(new Option("--set-default", "Set as default environment"));

  command.addHelpText(
    "after",
    '\nExamples:\n  $ scai setup init --wizard\n  $ scai setup init -n demo --project "My Project" --environment "Dev"\n'
  );

  command.action(async (options) => runInit(options));

  return command;
};
