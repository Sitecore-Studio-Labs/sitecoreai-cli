#!/usr/bin/env node

import packageJson from "../package.json";
import { createProgram, type RunCli } from "./program";
import { normalizeArgs } from "./commands/shared";
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
import { readRootConfiguration, readRootConfigurationFile } from "./config/root-config";
import { runDeployToken } from "./serialization/tasks/env/deploy-token";
import { runInit } from "./serialization/tasks/env/init";
import { getDeployToken } from "./shared/keychain";
import { installDeployTransportSpinner } from "./deploy/tasks/transport-spinner";

type AutoWizardNeed =
  | { kind: "init"; envName?: string; hint: string }
  | { kind: "login"; envName: string; hint: string };

/**
 * Returns a `.catch` handler for fire-and-forget observability writes
 * (history file, telemetry). Errors go to stderr so they don't corrupt
 * `--json` stdout but stay visible to operators chasing missing audit
 * events. Set `SITECOREAI_OBSERVABILITY_SILENT=1` to suppress.
 */
const logSwallowedObservabilityWrite =
  (origin: "history" | "telemetry") =>
  (error: unknown): void => {
    if (process.env.SITECOREAI_OBSERVABILITY_SILENT === "1") return;
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[scai:${origin}] write failed: ${detail}\n`);
  };

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

/**
 * Decide whether the cached deploy token has expired, for the
 * auto-wizard's re-login prompt. Per `docs/credentials.md` the token's
 * freshness metadata (`deployTokenExpiresIn` / `deployTokenLastUpdated`)
 * lives on the env profile in the config file — the config holds every
 * credential's and token's non-secret metadata. Reads only those fields.
 */
const isDeployTokenExpired = (
  env: { deployTokenExpiresIn?: number | null; deployTokenLastUpdated?: string | null } | undefined
): boolean => {
  const expiresIn = env?.deployTokenExpiresIn;
  const lastUpdatedRaw = env?.deployTokenLastUpdated;
  if (!expiresIn || !lastUpdatedRaw) {
    return false;
  }
  const lastUpdated = Date.parse(lastUpdatedRaw);
  if (Number.isNaN(lastUpdated)) {
    return false;
  }
  return Date.now() >= lastUpdated + expiresIn * 1000;
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
  // `capabilities` is a credential-free contract handshake — it must
  // answer instantly without triggering auto-init/auto-login.
  if (parent === "capabilities") {
    return true;
  }
  // `policy` manages the workspace guardrails — it must not trigger
  // auto-init/auto-login (e.g. `scai policy show` on an unconfigured dir).
  if (parent === "policy") {
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

  // Resolve the full config once so a CONFIG_INVALID profile routes to
  // the init-repair path, and so the env profile's deploy-token
  // freshness metadata is available below.
  let resolvedEnv: ReturnType<typeof readRootConfiguration>["environments"][string] | undefined;
  try {
    const resolvedRoot = readRootConfiguration(configBasePath, envName);
    resolvedEnv = resolvedRoot.environments[envName];
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
  // Bridge `--verbose` to an env flag so layers without a Logger (e.g. the
  // config loader) can surface diagnostics — see announceResolvedConfigPath.
  if (args.includes("--verbose") || args.includes("-v")) {
    process.env.SITECOREAI_VERBOSE = "1";
  }
  // The Deploy transport (`deployRequest`) stays silent for SDK
  // consumers; this is the CLI opting in to a spinner + HTTP trace.
  installDeployTransportSpinner();
  if (!options.skipBanner) {
    showBanner(packageJson.version);
  }

  const program = createProgram(runCli, { shellMode: options.shellMode });
  try {
    await runAutoWizardIfNeeded(args, configPath, outputOptions);
    await ensureTelemetryNotice(telemetryConfigPath);
    void Promise.resolve(ensureHistoryFile()).catch(logSwallowedObservabilityWrite("history"));
    void Promise.resolve(
      recordHistory({
        event: "start",
        command,
        args,
        cwd: process.cwd(),
      })
    ).catch(logSwallowedObservabilityWrite("history"));
    void Promise.resolve(
      recordTelemetry({
        event: "command_start",
        command: telemetryCommand,
        args,
        configPath: telemetryConfigPath,
      })
    ).catch(logSwallowedObservabilityWrite("telemetry"));

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
    ).catch(logSwallowedObservabilityWrite("history"));
    void Promise.resolve(
      recordTelemetry({
        event: "command_error",
        command: telemetryCommand,
        args,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        configPath: telemetryConfigPath,
      })
    ).catch(logSwallowedObservabilityWrite("telemetry"));
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
        remediation: finalError.remediation,
        // Structured three-way-merge conflicts on a POLICY_DENIED block,
        // so consumers route the conflict UI without regexing `message`.
        ...(finalError.conflicts ? { conflicts: finalError.conflicts } : {}),
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
      if (finalError.remediation) {
        const { actor, fix, detail } = finalError.remediation;
        baseLogger.warn(`Fix (${actor}): ${fix}${detail ? ` — ${detail}` : ""}`);
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
    //
    // stderr matters as much as stdout — the error path (the catch
    // block in runCli) routes through consola.error → stderr, and
    // a parent process capturing only stderr (the orchestrator's
    // brand-mode worker is one) used to see the captured buffer end
    // mid-line because process.exit fired before the stderr writable
    // buffer drained. Draining both in sequence is the fix; the
    // outer write covers stdout, the inner covers stderr.
    process.stdout.write("", () => {
      process.stderr.write("", () => {
        process.exit(process.exitCode ?? 0);
      });
    });
  });
} else {
  void cliPromise;
}
