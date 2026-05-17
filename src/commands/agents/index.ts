/**
 * `scai agents …` — Sitecore Agentic Studio.
 *
 * The command tree is organized by resource: `agent`, `space`, `skill`,
 * `widget`, `schema`, `mcp`, `html-template`, and `tool` are each a
 * subcommand group, plus session management (`login` / `logout` /
 * `status`) and the declarative `sync` path.
 *
 *   agents
 *     login | logout | status
 *     agent          {list, get, create, update, delete, duplicate, run}
 *     space          {get, artifacts, update}
 *     skill          {list, get, create, update, delete}
 *     widget         {list, get, create, update, delete}
 *     schema         {list, get, create, update, delete*}
 *     mcp            {list, get, create, update*, delete}
 *     html-template  {list, get, create, update*, delete*}
 *     tool           {list}
 *     sync           {pull, diff, push}
 *
 * Write support was verified live 2026-05-17 (agentic-studio-euw). `agent`,
 * `skill`, and `widget` have full CRUD; `schema` adds `update` (a re-POST
 * upsert); `mcp` adds `delete`. The starred ops (*) are UNVERIFIED — they
 * return 405/404 and stay gated behind `--unverified` — see
 * docs/agentic-studio-har-capture.md.
 */
import { Command, Option } from "commander";
import {
  htmlTemplateTasks,
  mcpTasks,
  runAgentCreate,
  runAgentDelete,
  runAgentDuplicate,
  runAgentGet,
  runAgentList,
  runAgentRun,
  runAgentUpdate,
  runAgentsLogin,
  runAgentsLogout,
  runAgentsStatus,
  requireUnverified,
  runSpaceArtifacts,
  runSpaceGet,
  runSpaceUpdate,
  runToolList,
  schemaTasks,
  skillTasks,
  widgetTasks,
  type ResourceTasks,
  type RunAgentsBaseOptions,
} from "@/agents/tasks";
import { confirmDestructive } from "@/shared/cli-tasks";
import {
  addApplyOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";
import { createAgentsSyncCommand } from "./sync";

// ---- shared option helpers ------------------------------------------------

/** Attach the env / config / verbosity options every `agents` command needs. */
const addBaseOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  return command;
};

/** The opt-in flag for an UNVERIFIED write (update / delete on a Part-B kind). */
const addUnverifiedOption = (command: Command): Command =>
  command.addOption(
    new Option(
      "--unverified",
      "Attempt this UNVERIFIED write — its endpoint is not confirmed (see docs/agentic-studio-har-capture.md)."
    )
  );

/** A `-f, --file` recipe-file option, mandatory. */
const fileOption = (resource: string): Option =>
  new Option(
    "-f, --file <path>",
    `Path to a ${resource} recipe file (YAML or JSON) — same format as \`scai agents sync\`.`
  ).makeOptionMandatory(true);

// ---- session --------------------------------------------------------------

const createLoginCommand = (): Command => {
  const command = new Command("login").description(
    "Capture an Agentic Studio browser session for the environment (opens a browser)."
  );
  addBaseOptions(command);
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

const createSessionCommand = (
  name: string,
  description: string,
  run: (options: RunAgentsBaseOptions) => Promise<void>
): Command => {
  const command = addBaseOptions(new Command(name).description(description));
  command.action(async (options: RunAgentsBaseOptions) => {
    await run(options);
  });
  return command;
};

// ---- agent group (full, verified CRUD) ------------------------------------

const createAgentGroup = (): Command => {
  const group = new Command("agent").description(
    "Agentic Studio agents — full create / read / update / delete."
  );

  const list = addBaseOptions(new Command("list").description("List agents."));
  list.action(async (options: RunAgentsBaseOptions) => {
    await runAgentList(options);
  });

  const get = addBaseOptions(
    new Command("get").description("Show one agent.").argument("<idOrSlug>", "Agent id or slug")
  );
  get.action(async (idOrSlug: string, options: RunAgentsBaseOptions) => {
    await runAgentGet({ ...options, idOrSlug });
  });

  const create = addBaseOptions(
    new Command("create").description("Create an agent from a recipe file.")
  );
  create.addOption(fileOption("agent"));
  addApplyOption(create);
  addWhatIfOption(create);
  create.action(
    withApplyGate(async (options: RunAgentsBaseOptions & { file: string; whatIf?: boolean }) => {
      await runAgentCreate(options);
    })
  );

  const update = addBaseOptions(
    new Command("update")
      .description("Update an agent from a recipe file (full-replacement of config).")
      .argument("<idOrSlug>", "Agent id or slug")
  );
  update.addOption(fileOption("agent"));
  addApplyOption(update);
  addWhatIfOption(update);
  update.action(async (idOrSlug: string, options: RunAgentsBaseOptions & { file: string }) => {
    await withApplyGate(async (opts: RunAgentsBaseOptions & { file: string; whatIf?: boolean }) => {
      await runAgentUpdate({ ...opts, idOrSlug });
    })(options);
  });

  const duplicate = addBaseOptions(
    new Command("duplicate")
      .description("Duplicate an agent under a new name.")
      .argument("<idOrSlug>", "Agent id or slug of the source")
      .addOption(new Option("--name <name>", "Name for the new agent").makeOptionMandatory(true))
  );
  addApplyOption(duplicate);
  addWhatIfOption(duplicate);
  duplicate.action(async (idOrSlug: string, options: RunAgentsBaseOptions & { name: string }) => {
    await withApplyGate(async (opts: RunAgentsBaseOptions & { name: string; whatIf?: boolean }) => {
      await runAgentDuplicate({ ...opts, idOrSlug });
    })(options);
  });

  const del = addBaseOptions(
    new Command("delete")
      .description("Delete an agent. Requires --apply; non-TTY callers must also pass --force.")
      .argument("<idOrSlug>", "Agent id or slug")
      .addOption(
        new Option("--force", "Skip the TTY confirmation prompt (required for non-TTY agents).")
      )
  );
  addApplyOption(del);
  addWhatIfOption(del);
  del.action(async (idOrSlug: string, options: RunAgentsBaseOptions & { force?: boolean }) => {
    await withApplyGate(
      async (opts: RunAgentsBaseOptions & { force?: boolean; whatIf?: boolean }) => {
        if (!opts.whatIf) {
          const confirmed = await confirmDestructive(
            `Delete agent "${idOrSlug}"? This cannot be undone.`,
            opts.force
          );
          if (!confirmed) {
            process.stderr.write("Aborted.\n");
            return;
          }
        }
        await runAgentDelete({ ...opts, idOrSlug });
      }
    )(options);
  });

  const run = addBaseOptions(
    new Command("run")
      .description("Run an agent and stream its output.")
      .argument("<agentSlug>", "Slug of the agent to run")
      .requiredOption("-m, --message <text>", "Message to send to the agent")
  );
  run.action(async (agentSlug: string, options: RunAgentsBaseOptions & { message: string }) => {
    await runAgentRun({ ...options, agentSlug, message: options.message });
  });

  group.addCommand(list, { isDefault: true });
  group.addCommand(get);
  group.addCommand(create);
  group.addCommand(update);
  group.addCommand(duplicate);
  group.addCommand(del);
  group.addCommand(run);
  return group;
};

// ---- space group (run container — read + config update) -------------------

/**
 * `scai agents space` — a space is the container a run executes in. The
 * BFF exposes no space list or delete, so the group is read + update:
 * `get` (config), `artifacts` (structured run output), and `update`
 * (rename / agents / context, by merging a patch into the live config).
 */
const createSpaceGroup = (): Command => {
  const group = new Command("space").description(
    "Agentic Studio spaces — the run container (read config + artifacts, update config)."
  );

  const get = addBaseOptions(
    new Command("get").description("Show a space's config.").argument("<spaceId>", "Space id")
  );
  get.action(async (spaceId: string, options: RunAgentsBaseOptions) => {
    await runSpaceGet({ ...options, spaceId });
  });

  const artifacts = addBaseOptions(
    new Command("artifacts")
      .description("Show a space's run artifacts — the structured output of its runs.")
      .argument("<spaceId>", "Space id")
  );
  artifacts.action(async (spaceId: string, options: RunAgentsBaseOptions) => {
    await runSpaceArtifacts({ ...options, spaceId });
  });

  const update = addBaseOptions(
    new Command("update")
      .description(
        "Update a space's config — merges a JSON/YAML patch into the live config " +
          "(rename via `spaceName`, change `agents` / `globalContext`)."
      )
      .argument("<spaceId>", "Space id")
  );
  update.addOption(
    new Option(
      "-f, --file <path>",
      "Path to a JSON/YAML patch — only the keys to change"
    ).makeOptionMandatory(true)
  );
  addApplyOption(update);
  addWhatIfOption(update);
  update.action(async (spaceId: string, options: RunAgentsBaseOptions & { file: string }) => {
    await withApplyGate(async (opts: RunAgentsBaseOptions & { file: string; whatIf?: boolean }) => {
      await runSpaceUpdate({ ...opts, spaceId });
    })(options);
  });

  group.addCommand(get);
  group.addCommand(artifacts);
  group.addCommand(update);
  return group;
};

// ---- non-agent resource groups --------------------------------------------

/**
 * Build a `{list, get, create, update, delete}` group for one of the
 * non-agent resources. `update` / `delete` are gated behind `--unverified`
 * unless the endpoint is confirmed against a live tenant — decided
 * per-operation from `tasks.updateVerified` / `tasks.deleteVerified`.
 */
const createResourceGroup = (
  name: string,
  description: string,
  idLabel: string,
  tasks: ResourceTasks
): Command => {
  const group = new Command(name).description(description);

  const list = addBaseOptions(new Command("list").description(`List ${name}s.`));
  list.action(async (options: RunAgentsBaseOptions) => {
    await tasks.runList(options);
  });

  const get = addBaseOptions(
    new Command("get").description(`Show one ${name}.`).argument("<idOrName>", idLabel)
  );
  get.action(async (idOrName: string, options: RunAgentsBaseOptions) => {
    await tasks.runGet({ ...options, idOrName });
  });

  const create = addBaseOptions(
    new Command("create").description(`Create a ${name} from a recipe file.`)
  );
  create.addOption(fileOption(name));
  addApplyOption(create);
  addWhatIfOption(create);
  create.action(
    withApplyGate(async (options: RunAgentsBaseOptions & { file: string; whatIf?: boolean }) => {
      await tasks.runCreate(options);
    })
  );

  const update = addBaseOptions(
    new Command("update")
      .description(
        tasks.updateVerified
          ? `Update a ${name} from a recipe file.`
          : `Update a ${name} from a recipe file. UNVERIFIED — requires ` +
              `--unverified (see docs/agentic-studio-har-capture.md).`
      )
      .argument("<idOrName>", idLabel)
  );
  update.addOption(fileOption(name));
  if (!tasks.updateVerified) addUnverifiedOption(update);
  addApplyOption(update);
  addWhatIfOption(update);
  update.action(async (idOrName: string, options: RunAgentsBaseOptions & { file: string }) => {
    await withApplyGate(
      async (
        opts: RunAgentsBaseOptions & { file: string; unverified?: boolean; whatIf?: boolean }
      ) => {
        await tasks.runUpdate({ ...opts, idOrName });
      }
    )(options);
  });

  const del = addBaseOptions(
    new Command("delete")
      .description(
        tasks.deleteVerified
          ? `Delete a ${name}. Requires --apply; --force for non-TTY.`
          : `Delete a ${name}. UNVERIFIED — requires --unverified ` +
              `(see docs/agentic-studio-har-capture.md). Requires --apply; --force for non-TTY.`
      )
      .argument("<idOrName>", idLabel)
      .addOption(
        new Option("--force", "Skip the TTY confirmation prompt (required for non-TTY agents).")
      )
  );
  if (!tasks.deleteVerified) addUnverifiedOption(del);
  addApplyOption(del);
  addWhatIfOption(del);
  del.action(async (idOrName: string, options: RunAgentsBaseOptions & { force?: boolean }) => {
    await withApplyGate(
      async (
        opts: RunAgentsBaseOptions & {
          force?: boolean;
          unverified?: boolean;
          whatIf?: boolean;
        }
      ) => {
        // Gate on `--unverified` before prompting, so the operator is not
        // asked to confirm a delete that would only then be rejected.
        if (!tasks.deleteVerified) {
          requireUnverified(opts.unverified, name, "delete");
        }
        if (!opts.whatIf) {
          const confirmed = await confirmDestructive(
            `Delete ${name} "${idOrName}"? This cannot be undone.`,
            opts.force
          );
          if (!confirmed) {
            process.stderr.write("Aborted.\n");
            return;
          }
        }
        await tasks.runDelete({ ...opts, idOrName });
      }
    )(options);
  });

  group.addCommand(list, { isDefault: true });
  group.addCommand(get);
  group.addCommand(create);
  group.addCommand(update);
  group.addCommand(del);
  return group;
};

/** `scai agents tool` — the tool catalog is read-only. */
const createToolGroup = (): Command => {
  const group = new Command("tool").description(
    "Agentic Studio tool catalog (read-only — no write path)."
  );
  const list = addBaseOptions(new Command("list").description("List the tool catalog."));
  list.action(async (options: RunAgentsBaseOptions) => {
    await runToolList(options);
  });
  group.addCommand(list, { isDefault: true });
  return group;
};

// ---- assembly -------------------------------------------------------------

export const createAgentsCommand = (): Command => {
  const command = new Command("agents").description(
    "Sitecore Agentic Studio — agents, skills, tools, widgets, schemas, custom MCPs."
  );

  command.addCommand(createLoginCommand());
  command.addCommand(
    createSessionCommand("logout", "Forget the stored Agentic Studio session.", runAgentsLogout)
  );
  command.addCommand(
    createSessionCommand("status", "Show the Agentic Studio session status.", runAgentsStatus)
  );

  command.addCommand(createAgentGroup());
  command.addCommand(createSpaceGroup());
  command.addCommand(
    createResourceGroup(
      "skill",
      "Agentic Studio skills — reusable markdown guidance an agent attaches.",
      "Skill id, slug, or name",
      skillTasks
    )
  );
  command.addCommand(
    createResourceGroup(
      "widget",
      "Agentic Studio widgets — configurable report/dashboard surfaces.",
      "Widget id or name",
      widgetTasks
    )
  );
  command.addCommand(
    createResourceGroup(
      "schema",
      "Agentic Studio structured-output schemas.",
      "Schema id or name",
      schemaTasks
    )
  );
  command.addCommand(
    createResourceGroup("mcp", "Registered custom MCP servers.", "Custom MCP id or name", mcpTasks)
  );
  command.addCommand(
    createResourceGroup(
      "html-template",
      "Agentic Studio HTML templates.",
      "HTML template id",
      htmlTemplateTasks
    )
  );
  command.addCommand(createToolGroup());
  command.addCommand(createAgentsSyncCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai agents login -n agents\n" +
      "  $ scai agents agent list -n agents\n" +
      "  $ scai agents agent create -f research.agent.yaml -n agents --apply\n" +
      "  $ scai agents agent run research-test -m 'Summarize the latest release' -n agents\n" +
      "  $ scai agents agent delete research-test -n agents --apply --force\n" +
      "  $ scai agents skill list -n agents\n" +
      "  $ scai agents space artifacts <spaceId> -n agents\n" +
      "\nVerified writes (2026-05-17): `agent`, `skill`, `widget` — full CRUD;\n" +
      "`schema` — list/get/create/update; `mcp` — list/get/create/delete.\n" +
      "`schema delete`, `mcp update`, and `html-template` writes are UNVERIFIED\n" +
      "(405/404) and require `--unverified` — see docs/agentic-studio-har-capture.md.\n" +
      "Declarative create/update across all kinds is also via `scai agents sync`.\n"
  );

  return command;
};
