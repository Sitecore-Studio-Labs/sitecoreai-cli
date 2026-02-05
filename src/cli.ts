#!/usr/bin/env node

import { Command } from "commander";
import packageJson from "../package.json";
import { createSerializationCommand } from "./commands/serialization";
import { normalizeArgs } from "./commands/shared";
import { createStatusCommand } from "./commands/status";
import { createLoginCommand } from "./commands/login";
import { createDeployCommand } from "./commands/deploy";
import { createHistoryCommand } from "./commands/history";
import { createInitCommand } from "./commands/init";
import { createLogoutCommand } from "./commands/logout";
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
import { toCliError, withHint } from "./shared/errors";
import { createConfigCommand } from "./commands/config";
import { createTelemetryCommand } from "./commands/telemetry";

const program = new Command();

program
  .name("scai")
  .description("SitecoreAI Deploy & Sync CLI for serialization and deploy workflows")
  .version(packageJson.version, "-V, --version", "Display the CLI version");

program.addCommand(createConfigCommand());
program.addCommand(createDeployCommand());
program.addCommand(createHistoryCommand());
program.addCommand(createInitCommand());
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createSerializationCommand());
program.addCommand(createStatusCommand());
program.addCommand(createTelemetryCommand());

program.showHelpAfterError(true);
program.showSuggestionAfterError(true);

const argv = normalizeArgs(process.argv);
const args = argv.slice(2);
const command = args.join(" ") || "(no command)";
const telemetryCommand = formatTelemetryCommand(args);
const configPath = resolveConfigPathFromArgs(argv);
const telemetryConfigPath = configPath ?? process.cwd();
const startTime = Date.now();
setTelemetryVersion(packageJson.version);
const outputOptions = resolveOutputOptionsFromArgs(argv);
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
showBanner(packageJson.version);

const run = async (): Promise<void> => {
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
};

const guessHint = (message: string): string | undefined => {
  if (message.includes("Deploy token not found")) {
    return "Run 'scai init' or 'scai login' to authenticate.";
  }
  if (message.includes("Deploy API access token is required")) {
    return "Provide --deploy-token or run 'scai login' to authenticate.";
  }
  if (message.includes("Project ID is required")) {
    return "Provide --project/--id or set projectId in the environment profile.";
  }
  if (message.includes("Environment ID is required")) {
    return "Provide --id/--name or set environmentId in the environment profile.";
  }
  if (message.includes("Environment name is required")) {
    return "Provide --environment-name or set defaultEnvProfile in the config.";
  }
  if (message.includes("Client ID and client secret are required")) {
    return "Provide --client-id/--client-secret or set SITECOREAI_CLIENT_ID/SECRET.";
  }
  if (message.includes("Client ID is required")) {
    return "Provide --client-id or set SITECOREAI_CLIENT_ID.";
  }
  if (message.includes("Environment host is not configured")) {
    return "Set a CM host with 'scai init' or pass --host.";
  }
  if (message.includes("configuration file")) {
    return "Run 'scai init' to create a config or fix the config file.";
  }
  return undefined;
};

run().catch((error) => {
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
  const cliError = toCliError(error);
  const redactedMessage = redactSecrets(cliError.message);
  const hint = cliError.hint ?? guessHint(redactedMessage);
  const finalError = hint ? withHint(cliError, hint) : cliError;
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
});
