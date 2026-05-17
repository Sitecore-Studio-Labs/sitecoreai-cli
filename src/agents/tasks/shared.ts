/**
 * Shared plumbing for the `scai agents …` task runners.
 *
 * Every runner resolves the environment, loads the keychain-backed
 * Agentic Studio session, calls a library helper, then prints human or
 * JSON output. The helpers here keep that boilerplate in one place.
 */
import { resolveEnvironment } from "@/shared/env";
import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { acquireAgentsSession } from "../session";
import type { AgentsSession } from "../session/types";

/** The option bag every `agents` runner accepts (env + verbosity flags). */
export interface RunAgentsBaseOptions {
  config?: string;
  environmentName?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

export const toLogger = (options: RunAgentsBaseOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

/** Write a value as pretty JSON to stdout (used by `--json` output paths). */
export const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

/** Resolve the env and load its Agentic Studio session. */
export const prepare = async (
  options: RunAgentsBaseOptions
): Promise<{ logger: Logger; session: AgentsSession; envName: string }> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const session = await acquireAgentsSession(envName);
  return { logger, session, envName };
};

/** Shared list rendering — JSON passthrough or one line per item. */
export const renderList = <T>(
  logger: Logger,
  label: string,
  items: T[],
  line: (item: T) => string
): void => {
  if (logger.isJson()) {
    writeJson(items);
    return;
  }
  if (items.length === 0) {
    logger.info(`No ${label} found.`, "yellow");
    return;
  }
  logger.info(`${items.length} ${label}:`, "cyan");
  for (const item of items) {
    logger.info(`  ${line(item)}`);
  }
};

/** Shared single-item rendering — JSON passthrough or a flat key/value list. */
export const renderItem = (logger: Logger, label: string, item: Record<string, unknown>): void => {
  if (logger.isJson()) {
    writeJson(item);
    return;
  }
  logger.info(`${label}:`, "cyan");
  for (const [key, value] of Object.entries(item)) {
    const rendered =
      value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
    logger.info(`  ${key}: ${rendered}`);
  }
};

/**
 * Gate an UNVERIFIED write (update / delete on a resource whose endpoint
 * has not been observed in a HAR). Throws unless the operator opted in
 * with `--unverified`. See docs/agentic-studio-har-capture.md.
 */
export const requireUnverified = (
  unverified: boolean | undefined,
  resource: string,
  verb: "update" | "delete"
): void => {
  if (unverified) return;
  throw createScaiError(
    `Agentic Studio exposes no verified ${verb} endpoint for ${resource}s.`,
    "INPUT_INVALID",
    {
      hint:
        `scai wires ${verb} as a best-guess REST call, but it is UNVERIFIED and ` +
        `may fail or hit the wrong endpoint. Re-run with --unverified to attempt ` +
        `it against a live tenant. See docs/agentic-studio-har-capture.md to ` +
        `capture the real request and stabilize it.`,
    }
  );
};
