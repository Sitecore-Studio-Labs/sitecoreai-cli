/**
 * `scai agents …` — Sitecore Agentic Studio.
 *
 * Session management (`login`, `logout`, `status`), reads (`list` and the
 * per-resource catalogs), running an agent (`run`), and `rm`. Creating or
 * updating agents/skills/widgets/MCPs is done declaratively via recipes
 * and `scai sync` — the recipe kinds converge them.
 *
 *   scai agents login -n agents
 *   scai agents list -n agents
 *   scai agents run research-test -m "Summarize the latest release" -n agents
 *   scai agents rm research-test --apply -n agents
 */
import { Command, Option } from "commander";
import {
  runAgentDelete,
  runAgentList,
  runAgentRun,
  runAgentsLogin,
  runAgentsLogout,
  runAgentsStatus,
  runCustomMcpList,
  runSchemaList,
  runSkillList,
  runToolList,
  runWidgetList,
  type RunAgentsBaseOptions,
} from "@/agents/tasks";
import {
  addApplyOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";
import { createAgentsSyncCommand } from "./sync";

/** A command that only needs the env / config / verbosity options. */
const createEnvCommand = (
  name: string,
  description: string,
  run: (options: RunAgentsBaseOptions) => Promise<void>
): Command => {
  const command = new Command(name).description(description);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: RunAgentsBaseOptions) => {
    await run(options);
  });
  return command;
};

const createLoginCommand = (): Command => {
  const command = new Command("login").description(
    "Capture an Agentic Studio browser session for the environment (opens a browser)."
  );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(
    new Option(
      "--region <region>",
      "Agentic Studio region (default: resolved from the environment's organization)"
    )
  );
  command.action(async (options: RunAgentsBaseOptions & { region?: string }) => {
    await runAgentsLogin(options);
  });
  return command;
};

const createRunCommand = (): Command => {
  const command = new Command("run")
    .description("Run an agent and stream its output.")
    .argument("<agentSlug>", "Slug of the agent to run")
    .requiredOption("-m, --message <text>", "Message to send to the agent");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (agentSlug: string, options: RunAgentsBaseOptions & { message: string }) => {
    await runAgentRun({ ...options, agentSlug, message: options.message });
  });
  return command;
};

const createRmCommand = (): Command => {
  const command = new Command("rm")
    .description("Delete an agent. Requires --apply.")
    .argument("<idOrSlug>", "Agent id or slug");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (idOrSlug: string, options: RunAgentsBaseOptions) => {
    await withApplyGate(async (opts: RunAgentsBaseOptions & { whatIf?: boolean }) => {
      await runAgentDelete({ ...opts, idOrSlug });
    })(options);
  });
  return command;
};

export const createAgentsCommand = (): Command => {
  const command = new Command("agents").description(
    "Sitecore Agentic Studio — agents, skills, tools, widgets, schemas, custom MCPs."
  );

  command.addCommand(createLoginCommand());
  command.addCommand(
    createEnvCommand("logout", "Forget the stored Agentic Studio session.", runAgentsLogout)
  );
  command.addCommand(
    createEnvCommand("status", "Show the Agentic Studio session status.", runAgentsStatus)
  );
  command.addCommand(createEnvCommand("list", "List agents.", runAgentList));
  command.addCommand(createEnvCommand("skills", "List skills.", runSkillList));
  command.addCommand(createEnvCommand("tools", "List the tool catalog.", runToolList));
  command.addCommand(createEnvCommand("widgets", "List widgets.", runWidgetList));
  command.addCommand(createEnvCommand("schemas", "List structured-output schemas.", runSchemaList));
  command.addCommand(
    createEnvCommand("mcps", "List registered custom MCP servers.", runCustomMcpList)
  );
  command.addCommand(createRunCommand());
  command.addCommand(createRmCommand());
  command.addCommand(createAgentsSyncCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai agents login -n agents\n" +
      "  $ scai agents list -n agents\n" +
      "  $ scai agents run research-test -m 'Summarize the latest release' -n agents\n" +
      "  $ scai agents rm research-test --apply -n agents\n" +
      "\nCreate/update agents, skills, widgets, and MCPs declaratively via recipes + `scai sync`.\n"
  );

  return command;
};
