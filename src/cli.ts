#!/usr/bin/env node

import { Command } from "commander";
import packageJson from "../package.json";
import { createAuditCommand } from "./commands/audit";
import { createCleanupCommand } from "./commands/cleanup";
import { createSerializationCommand } from "./commands/serialization";
import { normalizeArgs } from "./commands/shared";
import { createStatusCommand } from "./commands/status";
import { createLoginCommand } from "./commands/login";
import { createDeployCommand } from "./commands/deploy";
import { createHistoryCommand } from "./commands/history";
import { createInitCommand } from "./commands/init";
import { createLogoutCommand } from "./commands/logout";
import { createMcpCommand } from "./commands/mcp";
import { createRecipeCommand } from "./commands/recipe";
import { createShellCommand } from "./commands/shell";
import { ensureHistoryFile, recordHistory } from "./shared/history";
import { showBanner } from "./shared/style";
import { Logger } from "./shared/logger";
import {
  ensureTelemetryConsent,
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
import { readRootConfiguration, readRootConfigurationFile } from "./config";
import { runDeployToken, runInit } from "./serialization/tasks";
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
  const commandName = args[0];
  if (["init", "login", "logout", "telemetry", "config", "history", "mcp"].includes(commandName)) {
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
        hint: "Run 'scai init' to create a configuration file.",
      };
    }
    if (cliError.code === "CONFIG_INVALID") {
      return {
        kind: "init",
        envName: envFromArgs,
        hint: "Run 'scai init' to repair the configuration file.",
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
      hint: "Run 'scai init' to configure an environment.",
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
      hint: "Run 'scai init' to configure an environment.",
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
        hint: "Run 'scai init' to repair the configuration file.",
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
      hint: `Run 'scai login -n ${envName}' to authenticate.`,
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
    .description("SitecoreAI Deploy & Sync CLI for serialization and deploy workflows")
    .version(packageJson.version, "-V, --version", "Display the CLI version");

  program.addCommand(createAuditCommand());
  program.addCommand(createCleanupCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createDeployCommand());
  program.addCommand(createHistoryCommand());
  program.addCommand(createInitCommand());
  program.addCommand(createLoginCommand());
  program.addCommand(createLogoutCommand());
  program.addCommand(createMcpCommand());
  program.addCommand(createRecipeCommand());
  program.addCommand(createSerializationCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createTelemetryCommand());
  program.addCommand(createShellCommand(runCli));

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
    await ensureTelemetryConsent(telemetryConfigPath);
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
// Skipped under Vitest (see comment block above) AND under `scai mcp
// serve`: the stdio MCP server holds stdin open for the lifetime of
// the connection, so the natural exit path is when the parent (an MCP
// client) hangs up — never via process.exit from this wrapper.
const shouldForceExit = !process.env.VITEST && !process.env.SITECOREAI_MCP_SERVE;
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
