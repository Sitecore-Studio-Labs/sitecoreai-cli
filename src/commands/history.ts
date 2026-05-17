import { Command, Option } from "commander";
import { Logger } from "../shared/logger";
import { getHistoryPath, readHistory } from "../shared/history";
import { addVerbosityOptions } from "./shared";

type HistoryOptions = {
  path?: string;
  limit?: number;
  raw?: boolean;
  reverse?: boolean;
  showPath?: boolean;
  verbose?: boolean;
  trace?: boolean;
  json?: boolean;
  quiet?: boolean;
  logFile?: string;
};

const formatEntry = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }
  const entry = value as {
    timestamp?: string;
    event?: string;
    command?: string;
    error?: string;
  };
  const timestamp = entry.timestamp ?? "";
  const event = entry.event ?? "unknown";
  const command = entry.command ?? "(unknown)";
  const suffix = entry.error ? ` - ${entry.error}` : "";
  return `${timestamp} [${event}] ${command}${suffix}`.trim();
};

export const createHistoryCommand = (): Command => {
  const command = new Command("history").description("Show CLI activity history");

  command
    .addOption(new Option("--path <path>", "History log path override"))
    .addOption(new Option("--limit <number>", "Number of entries to show").argParser(Number))
    .addOption(new Option("--raw", "Print raw JSON lines"))
    .addOption(new Option("--reverse", "Show newest entries first"))
    .addOption(new Option("--show-path", "Show the history log path and exit"));
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    "\nExamples:\n  $ scai cli history --limit 20\n  $ scai cli history --show-path\n"
  );

  command.action(async (options: HistoryOptions) => {
    const logger = new Logger(
      Boolean(options.verbose),
      Boolean(options.trace),
      Boolean(options.json),
      Boolean(options.quiet),
      options.logFile
    );
    const filePath = options.path ?? getHistoryPath();
    if (options.showPath) {
      if (logger.isJson()) {
        logger.json({ path: filePath });
      } else {
        logger.info(filePath);
      }
      return;
    }
    const limit = options.limit ?? 50;
    const entries = await readHistory({ path: options.path, limit, reverse: options.reverse });

    if (logger.isJson()) {
      logger.json(entries.map(({ raw, entry }) => entry ?? { raw }));
      return;
    }

    if (entries.length === 0) {
      logger.info(`No CLI history recorded yet — log file: ${filePath}`);
      return;
    }

    for (const { raw, entry } of entries) {
      logger.info(options.raw || !entry ? raw : formatEntry(entry));
    }
  });

  return command;
};
