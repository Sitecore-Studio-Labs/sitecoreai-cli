import { consola } from "consola";
import fs from "node:fs";
import path from "node:path";

type LogLevel = "info" | "warn" | "error" | "verbose" | "debug" | "trace";

const colors: Record<string, string> = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const colorize = (value: string, color?: keyof typeof colors): string =>
  color ? `${colors[color]}${value}${colors.reset}` : value;

const ansiRegex = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");
const stripAnsi = (value: string): string => value.replace(ansiRegex, "");

const now = (): string => new Date().toISOString();

export class Logger {
  private static logFileErrorReported = false;

  constructor(
    private readonly verboseEnabled: boolean,
    private readonly traceEnabled: boolean,
    private readonly jsonEnabled = false,
    private readonly quietEnabled = false,
    private readonly logFilePath?: string
  ) {}

  private writeToFile(level: LogLevel, message: string): void {
    if (!this.logFilePath) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
      const payload = `[${now()}] ${level.toUpperCase()} ${stripAnsi(message)}`;
      fs.appendFileSync(this.logFilePath, `${payload}\n`, "utf8");
    } catch (error) {
      if (Logger.logFileErrorReported) {
        return;
      }
      Logger.logFileErrorReported = true;
      if (this.jsonEnabled || this.quietEnabled) {
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      consola.warn(`Unable to write log file: ${detail}`);
    }
  }

  private formatMessage(message: string): string {
    if (!this.verboseEnabled && !this.traceEnabled) {
      return message;
    }
    return `[${now()}] ${message}`;
  }

  isJson(): boolean {
    return this.jsonEnabled;
  }

  info(message: string, color?: keyof typeof colors): void {
    this.writeToFile("info", message);
    if (this.quietEnabled) {
      return;
    }
    if (this.jsonEnabled) {
      return;
    }
    consola.info(colorize(this.formatMessage(message), color));
  }

  warn(message: string, color?: keyof typeof colors): void {
    this.writeToFile("warn", message);
    if (this.quietEnabled) {
      return;
    }
    if (this.jsonEnabled) {
      return;
    }
    consola.warn(colorize(this.formatMessage(message), color ?? "yellow"));
  }

  error(message: string, color?: keyof typeof colors): void {
    const formatted = this.formatMessage(message);
    this.writeToFile("error", message);
    if (this.jsonEnabled) {
      return;
    }
    consola.error(colorize(formatted, color ?? "red"));
  }

  verbose(message: string, color?: keyof typeof colors): void {
    this.writeToFile("verbose", message);
    if (this.quietEnabled) {
      return;
    }
    if (this.jsonEnabled) {
      return;
    }
    if (this.verboseEnabled) {
      consola.debug(colorize(this.formatMessage(message), color ?? "gray"));
    }
  }

  debug(message: string, color?: keyof typeof colors): void {
    this.writeToFile("debug", message);
    if (this.quietEnabled) {
      return;
    }
    if (this.jsonEnabled) {
      return;
    }
    if (this.traceEnabled) {
      consola.debug(colorize(this.formatMessage(message), color ?? "gray"));
    }
  }

  trace(message: string, color?: keyof typeof colors): void {
    this.writeToFile("trace", message);
    if (this.quietEnabled) {
      return;
    }
    if (this.jsonEnabled) {
      return;
    }
    if (this.traceEnabled) {
      consola.trace(colorize(this.formatMessage(message), color ?? "gray"));
    }
  }

  json(data: unknown): void {
    const output = JSON.stringify(data, null, 2);
    this.writeToFile("info", output);
    consola.info(output);
  }

  log(level: LogLevel, message: string, color?: keyof typeof colors): void {
    switch (level) {
      case "info":
        this.info(message, color);
        break;
      case "warn":
        this.warn(message, color);
        break;
      case "error":
        this.error(message, color);
        break;
      case "verbose":
        this.verbose(message, color);
        break;
      case "debug":
        this.debug(message, color);
        break;
      case "trace":
        this.trace(message, color);
        break;
      default:
        this.info(message, color);
        break;
    }
  }
}
