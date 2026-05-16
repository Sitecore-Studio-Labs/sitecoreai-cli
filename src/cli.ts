#!/usr/bin/env node

import { Command } from "commander";
import packageJson from "../package.json";
import { createAuditCommand } from "./commands/audit";
import { createBrandCommand } from "./commands/brand";
import { createCleanupCommand } from "./commands/cleanup";
// `content version` is intentionally not registered — see the content
// command block below. Import stays commented out to avoid an unused symbol.
// import { createContentVersionCommand } from "./commands/content/version";
import { createSerializationCommand } from "./commands/serialization";
import { normalizeArgs } from "./commands/shared";
import { createStatusCommand } from "./commands/status";
import { createLoginCommand } from "./commands/login";
import { createDeployCommand } from "./commands/deploy";
import { createExplainCommand } from "./commands/explain";
import { createHealthCommand } from "./commands/health";
import { createHistoryCommand } from "./commands/history";
import { createInitCommand } from "./commands/init";
import { createLogoutCommand } from "./commands/logout";
import { createSetupClientCommand } from "./commands/setup-client";
import { createMcpCommand } from "./commands/mcp";
import { createBriefCommand } from "./commands/brief";
import { createCampaignCommand } from "./commands/campaign";
import { createAgentsCommand } from "./commands/agents";
import { createPublishCommand } from "./commands/publish";
import { createTopicsCommand } from "./commands/topics";
import { createRecipeCommand } from "./commands/recipe";
import { createSyncCommand } from "./commands/sync";
import { createShellCommand } from "./commands/shell";
import { ensureHistoryFile, recordHistory } from "./shared/history";
import { showBanner } from "./shared/style";
import { Logger } from "./shared/logger";
import {
  ensureTelemetryNotice,
  formatTelemetryCommand,
  recordTelemetry,
  resolveConfigPathFromArgs,
  setTelemetryVersion,
} from "./shared/telemetry";
import { resolveOutputOptionsFromArgs } from "./shared/output";
import { redactSecrets } from "./shared/redact";
import { toScaiError } from "./shared/errors";
import { createConfigCommand } from "./commands/config";
import { createTelemetryCommand } from "./commands/telemetry";
import { createWebhookCommand } from "./commands/webhook";
import { createWorkflowCommand } from "./commands/workflow";
import { readRootConfiguration, readRootConfigurationFile } from "./config/root-config";
import { runDeployToken } from "./serialization/tasks/env/deploy-token";
import { runInit } from "./serialization/tasks/env/init";
import { getDeployToken } from "./shared/keychain";

type AutoWizardNeed =
  | { kind: "init"; envName?: string; hint: string }
  | { kind: "login"; envName: string; hint: string };

const toBoolean = (value?: string): boolean | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
};

type DeployTokenTiming = {
  deployTokenExpiresIn?: number | null;
  deployTokenLastUpdated?: string | null;
};

const isDeployTokenExpired = (env?: DeployTokenTiming): boolean => {
  if (!env?.deployTokenExpiresIn || !env.deployTokenLastUpdated) {
    return false;
  }
  const lastUpdated = Date.parse(env.deployTokenLastUpdated);
  if (Number.isNaN(lastUpdated)) {
    return false;
  }
  return Date.now() >= lastUpdated + env.deployTokenExpiresIn * 1000;
};

const resolveEnvironmentNameFromArgs = (args: string[]): string | undefined => {
  const index = args.findIndex((arg) => arg === "--environment-name" || arg === "-n");
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  const inline = args.find((arg) => arg.startsWith("--environment-name=") || arg.startsWith("-n="));
  if (inline) {
    return inline.split("=").slice(1).join("=");
  }
  return undefined;
};

const shouldSkipAutoWizard = (args: string[]): boolean => {
  if (toBoolean(process.env.SITECOREAI_AUTO_WIZARD) === false) {
    return true;
  }
  if (args.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg))) {
    return true;
  }
  // Commands that must not trigger auto-init/auto-login. Most now live
  // under the `setup` and `cli` parents, so match the [parent, child]
  // pair; `mcp` stayed top-level.
  const [parent, child] = args;
  if (parent === "mcp") {
    return true;
  }
  if (parent === "setup" && ["init", "login", "logout", "client"].includes(child)) {
    return true;
  }
  if (parent === "cli" && ["telemetry", "config", "history"].includes(child)) {
    return true;
  }
  return false;
};

const resolveAutoWizardNeed = async (
  args: string[],
  configBasePath: string
): Promise<AutoWizardNeed | null> => {
  const envFromArgs = resolveEnvironmentNameFromArgs(args);
  let configFile: ReturnType<typeof readRootConfigurationFile> | null = null;
  try {
    configFile = readRootConfigurationFile(configBasePath);
  } catch (error) {
    const cliError = toScaiError(error);
    if (cliError.code === "CONFIG_NOT_FOUND") {
      return {
        kind: "init",
        envName: envFromArgs,
        hint: "Run 'scai setup init' to create a configuration file.",
      };
    }
    if (cliError.code === "CONFIG_INVALID") {
      return {
        kind: "init",
        envName: envFromArgs,
        hint: "Run 'scai setup init' to repair the configuration file.",
      };
    }
    return null;
  }

  const envProfiles = configFile.config.envProfiles ?? {};
  const envNames = Object.keys(envProfiles);
  if (envNames.length === 0) {
    return {
      kind: "init",
      envName: envFromArgs,
      hint: "Run 'scai setup init' to configure an environment.",
    };
  }

  const envName =
    envFromArgs ??
    configFile.config.defaultEnvProfile ??
    (envNames.length === 1 ? envNames[0] : undefined);
  if (!envName || !envProfiles[envName]) {
    return {
      kind: "init",
      envName,
      hint: "Run 'scai setup init' to configure an environment.",
    };
  }

  let resolvedEnv: DeployTokenTiming | undefined;
  try {
    const root = readRootConfiguration(configBasePath, envName);
    resolvedEnv = root.environments[envName] ?? envProfiles[envName];
  } catch (error) {
    const cliError = toScaiError(error);
    if (cliError.code === "CONFIG_INVALID") {
      return {
        kind: "init",
        envName,
        hint: "Run 'scai setup init' to repair the configuration file.",
      };
    }
    return null;
  }

  if (process.env.SITECOREAI_DEPLOY_TOKEN) {
    return null;
  }
  const deployToken = await getDeployToken(envName);
  const tokenExpired = isDeployTokenExpired(resolvedEnv);
  if (!deployToken || tokenExpired) {
    return {
      kind: "login",
      envName,
      hint: `Run 'scai setup login -n ${envName}' to authenticate.`,
    };
  }

  return null;
};

type RunCliOptions = {
  baseEnv?: Record<string, string | undefined>;
  skipBanner?: boolean;
  shellMode?: boolean;
};

type RunCli = (argv: string[], options?: RunCliOptions) => Promise<void>;

const applyBaseEnv = (snapshot?: Record<string, string | undefined>): void => {
  if (!snapshot) {
    return;
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const runAutoWizardIfNeeded = async (
  args: string[],
  configPath: string | undefined,
  outputOptions: ReturnType<typeof resolveOutputOptionsFromArgs>
): Promise<void> => {
  if (shouldSkipAutoWizard(args)) {
    return;
  }
  const configBasePath = configPath ?? process.cwd();
  const need = await resolveAutoWizardNeed(args, configBasePath);
  if (!need) {
    return;
  }
  const logger = new Logger(
    false,
    false,
    Boolean(outputOptions.json),
    Boolean(outputOptions.quiet),
    outputOptions.logFile ?? process.env.SITECOREAI_LOG_FILE
  );
  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && process.env.SITECOREAI_NON_INTERACTIVE !== "1";
  if (!isInteractive || outputOptions.json || outputOptions.quiet) {
    logger.warn(`Auto-setup skipped. ${need.hint}`);
    return;
  }
  if (need.kind === "init") {
    logger.info("Launching setup wizard to configure SitecoreAI.", "cyan");
    await runInit({
      config: configBasePath,
      environmentName: need.envName,
      wizard: true,
    });
    return;
  }
  logger.info(`Authenticating environment '${need.envName}'.`, "cyan");
  await runDeployToken({ config: configBasePath, environmentName: need.envName });
};

const createProgram = (runCli: RunCli, options: { shellMode?: boolean } = {}): Command => {
  const program = new Command();
  program
    .name("scai")
    .description(
      "SitecoreAI developer toolkit — deploy, serialization, recipes, publishing, and MCP"
    )
    .version(packageJson.version, "-V, --version", "Display the CLI version");

  // Top-level command groups. The CLI surface is organized by product
  // area, not flat — each parent below is a namespace, and the leaf
  // command builders are unchanged (only where they attach moved).
  const setup = new Command("setup").description(
    "Configure environments and authenticate — init, login, env, logout, status"
  );
  setup.addCommand(createInitCommand());
  setup.addCommand(createLoginCommand());
  setup.addCommand(createSetupClientCommand());
  setup.addCommand(createLogoutCommand());
  setup.addCommand(createStatusCommand());

  const hygiene = new Command("hygiene").description(
    "Content quality — read-only audits, mutating cleanup, and composed diagnostics"
  );
  hygiene.addCommand(createAuditCommand());
  hygiene.addCommand(createCleanupCommand());
  hygiene.addCommand(createExplainCommand());

  // `webhook` nests under `workflow`; the old standalone `content`
  // wrapper is dropped — its only child (`version`) attaches directly.
  const workflow = createWorkflowCommand();
  workflow.addCommand(createWebhookCommand());
  const content = new Command("content").description(
    "Operate on content items — publish and workflow handlers"
  );
  content.addCommand(createPublishCommand());
  content.addCommand(workflow);
  // `content version` (per-version publish-state fields — __Never publish,
  // __Valid from / __Valid to) is intentionally NOT registered yet. Those
  // fields only make sense once content items (pages, etc.) can be authored
  // through the CLI; today they only arrive via recipes, so a lone
  // version-state verb is more confusing than useful. The SDK
  // (src/content/api/version-fields.ts) and `hygiene cleanup versions` both
  // stay — only this CLI command group is hidden until item primitives land.
  // content.addCommand(createContentVersionCommand());
  content.addHelpText(
    "after",
    "\nRoadmap: `scai content sites` and `scai content pages` — XM Cloud\n" +
      "site and page management — are planned, not yet shipped. See docs/roadmap.md.\n"
  );

  const ops = new Command("ops").description("Sitecore Content Operations — briefs and campaigns");
  ops.addCommand(createBriefCommand());
  ops.addCommand(createCampaignCommand());

  const provision = new Command("provision").description(
    "Provision environments and content-as-code — deploy, serialization, recipes"
  );
  provision.addCommand(createDeployCommand());
  provision.addCommand(createSerializationCommand());
  provision.addCommand(createRecipeCommand());
  provision.addHelpText(
    "after",
    "\nRoadmap: `scai provision iar` — package content as Items-as-Resources\n" +
      "(IAR) — is planned, not yet shipped. See docs/roadmap.md.\n"
  );

  const cli = new Command("cli").description("CLI tooling — config, diagnostics, history, REPL");
  cli.addCommand(createConfigCommand());
  cli.addCommand(createHealthCommand());
  cli.addCommand(createHistoryCommand());
  cli.addCommand(createShellCommand(runCli));
  cli.addCommand(createTelemetryCommand());
  cli.addCommand(createTopicsCommand());

  program.addCommand(setup);
  program.addCommand(hygiene);
  program.addCommand(content);
  program.addCommand(ops);
  program.addCommand(createBrandCommand());
  program.addCommand(createAgentsCommand());
  program.addCommand(provision);
  program.addCommand(createSyncCommand());
  // `mcp` stays top-level: `scai mcp serve` is wired into external MCP
  // client configs, so its path must not move under a group.
  program.addCommand(createMcpCommand());
  program.addCommand(cli);

  program.showHelpAfterError(true);
  program.showSuggestionAfterError(true);
  if (options.shellMode) {
    program.exitOverride();
  }
  return program;
};

const runCli: RunCli = async (inputArgv, options = {}): Promise<void> => {
  const argv = normalizeArgs(inputArgv);
  const args = argv.slice(2);
  const command = args.join(" ") || "(no command)";
  const telemetryCommand = formatTelemetryCommand(args);
  const configPath = resolveConfigPathFromArgs(argv);
  const telemetryConfigPath = configPath ?? process.cwd();
  const startTime = Date.now();
  setTelemetryVersion(packageJson.version);
  const outputOptions = resolveOutputOptionsFromArgs(argv);

  applyBaseEnv(options.baseEnv);
  const nonInteractive = args.includes("--non-interactive");
  if (nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.env.SITECOREAI_NON_INTERACTIVE = "1";
  }
  if (outputOptions.quiet) {
    process.env.SITECOREAI_QUIET = "1";
  }
  if (outputOptions.json) {
    process.env.SITECOREAI_JSON = "1";
  }
  if (args.includes("--trace") || args.includes("-t")) {
    process.env.SITECOREAI_TRACE_HTTP = "1";
  }
  if (!options.skipBanner) {
    showBanner(packageJson.version);
  }

  const program = createProgram(runCli, { shellMode: options.shellMode });
  try {
    await runAutoWizardIfNeeded(args, configPath, outputOptions);
    await ensureTelemetryNotice(telemetryConfigPath);
    void Promise.resolve(ensureHistoryFile()).catch(() => {});
    void Promise.resolve(
      recordHistory({
        event: "start",
        command,
        args,
        cwd: process.cwd(),
      })
    ).catch(() => {});
    void Promise.resolve(
      recordTelemetry({
        event: "command_start",
        command: telemetryCommand,
        args,
        configPath: telemetryConfigPath,
      })
    ).catch(() => {});

    await program.parseAsync(argv);
    await recordHistory({
      event: "success",
      command,
      args,
      cwd: process.cwd(),
    });
    await recordTelemetry({
      event: "command_success",
      command: telemetryCommand,
      args,
      durationMs: Date.now() - startTime,
      configPath: telemetryConfigPath,
    });
  } catch (error) {
    if (
      options.shellMode &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("commander.")
    ) {
      if (error.code === "commander.unknownCommand") {
        console.log("Unknown command. Available commands:\n");
        program.outputHelp();
      }
      process.exitCode = 0;
      return;
    }
    void Promise.resolve(
      recordHistory({
        event: "error",
        command,
        args,
        cwd: process.cwd(),
        error: error instanceof Error ? error.message : String(error),
      })
    ).catch(() => {});
    void Promise.resolve(
      recordTelemetry({
        event: "command_error",
        command: telemetryCommand,
        args,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        configPath: telemetryConfigPath,
      })
    ).catch(() => {});
    const baseLogger = new Logger(
      false,
      false,
      Boolean(outputOptions.json),
      Boolean(outputOptions.quiet),
      outputOptions.logFile ?? process.env.SITECOREAI_LOG_FILE
    );
    const cliError = toScaiError(error);
    const redactedMessage = redactSecrets(cliError.message);
    const finalError = cliError;
    if (baseLogger.isJson()) {
      baseLogger.json({
        message: redactedMessage,
        code: finalError.code,
        hint: finalError.hint,
        details: finalError.details,
        exitCode: finalError.exitCode,
      });
    } else {
      baseLogger.error(redactedMessage);
      if (finalError.details && finalError.details.length > 0) {
        for (const detail of finalError.details) {
          baseLogger.verbose(`  - ${detail}`);
        }
      }
      if (finalError.hint) {
        baseLogger.warn(`Hint: ${finalError.hint}`);
      }
    }
    process.exitCode = finalError.exitCode;
  }
};

// Force-exit after the command resolves. Without this, the process can
// hang for tens of seconds (or indefinitely) waiting for undici's
// keep-alive socket pool to close out the global dispatcher's idle
// connections — Node only exits when the event loop is empty, and HTTP
// keep-alive sockets count as live handles. Bind-site is the most
// visible offender (it's the last step of the deploy pipeline, so the
// hang isn't masked by a follow-up command), but every command that
// makes Authoring API calls has the same exposure. Setting `exitCode`
// alone (the previous behaviour) is necessary but not sufficient —
// `process.exit` is the explicit teardown.
//
// Skipped under Vitest: the test suite dynamic-imports this module to
// drive `runCli` directly, and `process.exit` inside a test worker
// surfaces as an "Uncaught Exception" failure. `process.env.VITEST`
// is set automatically by Vitest's runner.
//
// Skipped for `scai mcp serve` (either transport): the MCP server is a
// long-lived process — stdio holds stdin open, http holds a listener
// open — so the natural exit path is the client hanging up or a
// signal, never a force-exit the instant the command's promise
// settles. Detected from argv: `installMcpStdoutDiscipline()` sets
// `SITECOREAI_MCP_SERVE` inside the command action, which is too late
// to be read at this module-eval point (it only lands in time when a
// parent process — smoke / integration harness — exports it).
const isMcpServeInvocation = (argv: string[]): boolean => {
  const positionals = argv.slice(2).filter((arg) => !arg.startsWith("-"));
  return positionals[0] === "mcp" && positionals[1] === "serve";
};
const shouldForceExit =
  !process.env.VITEST && !process.env.SITECOREAI_MCP_SERVE && !isMcpServeInvocation(process.argv);
const cliPromise = runCli(process.argv);
if (shouldForceExit) {
  void cliPromise.finally(() => {
    // Allow stdout/stderr to drain before exiting. `process.stdout.write`
    // with a callback flushes the writable buffer; we exit from inside
    // the callback so logs emitted at the end of a command (the bind
    // result, error hints) reach the parent process.
    process.stdout.write("", () => {
      process.exit(process.exitCode ?? 0);
    });
  });
} else {
  void cliPromise;
}
