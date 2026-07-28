import { Command } from "commander";
import { readRootConfigurationFile } from "@/config/root-config";
import { Logger } from "@/shared/logger";
import { addConfigOption, addVerbosityOptions } from "./shared";

type ConfigValidateOptions = {
  config?: string;
  verbose?: boolean;
  trace?: boolean;
  json?: boolean;
  quiet?: boolean;
  logFile?: string;
};

export const createConfigCommand = (): Command => {
  const command = new Command("config").description("Configuration utilities");

  const validate = new Command("validate").description("Validate sitecoreai.cli.json");
  addConfigOption(validate);
  addVerbosityOptions(validate);
  validate.action(async (options: ConfigValidateOptions) => {
    const logger = new Logger(
      Boolean(options.verbose),
      Boolean(options.trace),
      Boolean(options.json),
      Boolean(options.quiet),
      options.logFile
    );
    const configPath = options.config ?? process.cwd();
    const result = readRootConfigurationFile(configPath);
    if (logger.isJson()) {
      logger.json({ valid: true, path: result.rootPath });
      return;
    }
    logger.info(`Config valid: ${result.rootPath}`, "green");
  });

  command.addCommand(validate);
  command.addHelpText("after", "\nExample:\n  $ scai cli config validate\n");
  return command;
};
