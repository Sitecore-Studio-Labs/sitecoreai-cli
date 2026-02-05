import { Command } from "commander";
import { addConfigOption, addVerbosityOptions } from "./shared";
import { getTelemetryStatus } from "../shared/telemetry";
import { Logger } from "../shared/logger";

type TelemetryOptions = {
  config?: string;
  verbose?: boolean;
  trace?: boolean;
  json?: boolean;
  quiet?: boolean;
  logFile?: string;
};

export const createTelemetryCommand = (): Command => {
  const command = new Command("telemetry").description("Telemetry utilities");

  const status = new Command("status").description("Show telemetry status");
  addConfigOption(status);
  addVerbosityOptions(status);
  status.action(async (options: TelemetryOptions) => {
    const logger = new Logger(
      Boolean(options.verbose),
      Boolean(options.trace),
      Boolean(options.json),
      Boolean(options.quiet),
      options.logFile
    );
    const statusInfo = getTelemetryStatus(options.config ?? process.cwd());
    if (logger.isJson()) {
      logger.json(statusInfo);
      return;
    }
    logger.info(`Telemetry: ${statusInfo.enabled ? "enabled" : "disabled"}`, "cyan");
    logger.info(`Source: ${statusInfo.source}`);
    logger.info(`Endpoint: ${statusInfo.url}`);
  });

  command.addCommand(status);
  command.addHelpText("after", "\nExample:\n  $ scai telemetry status\n");
  return command;
};
