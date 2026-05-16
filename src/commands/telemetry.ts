import { Command } from "commander";
import { addConfigOption, addVerbosityOptions } from "./shared";
import { getTelemetryStatus } from "../shared/telemetry";
import { readRootConfigurationFile, writeRootConfigurationFile } from "../config/root-config";
import { Logger } from "../shared/logger";

type TelemetryOptions = {
  config?: string;
  verbose?: boolean;
  trace?: boolean;
  json?: boolean;
  quiet?: boolean;
  logFile?: string;
};

const buildLogger = (options: TelemetryOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile
  );

/**
 * Persist `settings.telemetryEnabled` to the root config. Telemetry is
 * opt-out (on by default), so `disable` is the primary lever here;
 * `enable` exists for symmetry and to undo a prior `disable`.
 */
const writeTelemetrySetting = (configPath: string, enabled: boolean): void => {
  const root = readRootConfigurationFile(configPath);
  writeRootConfigurationFile(root.rootPath, {
    ...root.config,
    settings: {
      ...(root.config.settings ?? {}),
      telemetryEnabled: enabled,
    },
  });
};

export const createTelemetryCommand = (): Command => {
  const command = new Command("telemetry").description("Telemetry utilities");

  const status = new Command("status").description("Show telemetry status");
  addConfigOption(status);
  addVerbosityOptions(status);
  status.action(async (options: TelemetryOptions) => {
    const logger = buildLogger(options);
    const statusInfo = getTelemetryStatus(options.config ?? process.cwd());
    if (logger.isJson()) {
      logger.json(statusInfo);
      return;
    }
    logger.info(`Telemetry: ${statusInfo.enabled ? "enabled" : "disabled"}`, "cyan");
    logger.info(`Source: ${statusInfo.source}`);
    logger.info(`Endpoint: ${statusInfo.url}`);
  });

  const enable = new Command("enable").description("Enable anonymous usage telemetry");
  addConfigOption(enable);
  addVerbosityOptions(enable);
  enable.action(async (options: TelemetryOptions) => {
    const logger = buildLogger(options);
    const configPath = options.config ?? process.cwd();
    writeTelemetrySetting(configPath, true);
    if (logger.isJson()) {
      logger.json({ enabled: true });
      return;
    }
    logger.info("Telemetry enabled.", "cyan");
  });

  const disable = new Command("disable").description("Disable anonymous usage telemetry");
  addConfigOption(disable);
  addVerbosityOptions(disable);
  disable.action(async (options: TelemetryOptions) => {
    const logger = buildLogger(options);
    const configPath = options.config ?? process.cwd();
    writeTelemetrySetting(configPath, false);
    if (logger.isJson()) {
      logger.json({ enabled: false });
      return;
    }
    logger.info("Telemetry disabled.", "cyan");
  });

  command.addCommand(status);
  command.addCommand(enable);
  command.addCommand(disable);
  command.addHelpText(
    "after",
    [
      "",
      "Telemetry is enabled by default (opt-out). SITECOREAI_TELEMETRY=false and",
      "the cross-tool DO_NOT_TRACK=1 env var also disable it.",
      "",
      "Examples:",
      "  $ scai cli telemetry status",
      "  $ scai cli telemetry disable",
      "",
    ].join("\n")
  );
  return command;
};
