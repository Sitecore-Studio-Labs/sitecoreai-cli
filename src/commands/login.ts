import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { runDeployToken } from "../serialization/tasks";
import { runAiSkillsLogin } from "../brand/tasks/login";

/**
 * `scai login ai-skills` — provision a Sitecore AI Skills credential
 * for the active environment's organization. AI APIs keys are
 * created at Cloud Portal → Stream → Admin → AI APIs keys and are
 * org-scoped (one-org-per-credential), so they live in a separate
 * `aiSkills[orgId]` config block from the env-scoped Pages/Sites
 * automation client `scai login` provisions.
 */
const createLoginAiSkillsCommand = (): Command => {
  const command = new Command("ai-skills").description(
    "Provision a Sitecore AI Skills credential (Brand Management + Brand Review) for the active environment's organization"
  );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

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
    "\nCreate the credential in Cloud Portal → Stream → Admin → AI APIs keys, then:\n  $ scai login ai-skills -n sandbox\n  $ scai login ai-skills --org-id org_xxx --client-id <id> --client-secret <secret>\n"
  );

  command.action(async (options) => runAiSkillsLogin(options));

  return command;
};

export const createLoginCommand = (): Command => {
  const command = new Command("login").description(
    "Authenticate with SitecoreAI and store an access token (Deploy + CM/admin scopes)"
  );

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command
    .addOption(new Option("--client-id <id>", "SitecoreAI client ID"))
    .addOption(new Option("--client-secret <secret>", "SitecoreAI client secret"))
    .addOption(
      new Option("--use-client-credentials", "Use client credentials instead of interactive login")
    )
    .addOption(new Option("--print", "Print the access token to stdout"));

  command.addHelpText(
    "after",
    "\nExamples:\n  $ scai login -n demo\n  $ scai login -n demo --use-client-credentials\n  $ scai login ai-skills -n demo   (provision AI Skills credential)\n"
  );

  command.action(async (options) => runDeployToken(options));

  command.addCommand(createLoginAiSkillsCommand());

  return command;
};
