import { Command, Option } from "commander";
import fs from "node:fs/promises";
import { Logger } from "../shared/logger";
import { getHistoryPath } from "../shared/history";
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

    // A missing log file means nothing has been recorded yet — the same
    // state as an empty file. Both resolve to an empty entry list rather
    // than an error; only an unexpected read failure propagates.
    let lines: string[] = [];
    try {
      const content = await fs.readFile(filePath, "utf8");
      lines = content.split("\n").filter((line) => line.trim().length > 0);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    const selected = limit > 0 ? lines.slice(-limit) : lines;
    const output = options.reverse ? [...selected].reverse() : selected;

    if (logger.isJson()) {
      const parsed = output.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
      logger.json(parsed);
      return;
    }

    if (output.length === 0) {
      logger.info(`No CLI history recorded yet — log file: ${filePath}`);
      return;
    }

    for (const line of output) {
      if (options.raw) {
        logger.info(line);
        continue;
      }
      try {
        logger.info(formatEntry(JSON.parse(line)));
      } catch {
        logger.info(line);
      }
    }
  });

  return command;
};
