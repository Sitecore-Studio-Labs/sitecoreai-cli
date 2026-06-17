/**
 * Shared plumbing for the `scai agents …` task runners.
 *
 * Every runner resolves the environment, loads the keychain-backed
 * Agentic Studio session, calls a library helper, then prints human or
 * JSON output. The helpers here keep that boilerplate in one place.
 */
import { Logger } from "@/shared/logger";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createScaiError } from "@/shared/errors";
import { resolveAgentsSession } from "../client";
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

/**
 * Emit a canonical `ScaiEnvelope` on stdout. Used by `--json` output
 * paths across the agents task family. Each call site passes a
 * command suffix that gets prefixed with `agents.` (e.g. `agent.list`
 * → `agents.agent.list`) plus the env name from the options bag.
 */
export const writeAgentsEnvelope = (
  command: string,
  options: RunAgentsBaseOptions,
  data: unknown,
  extra?: Record<string, unknown>
): void => {
  const envelope = buildScaiEnvelope({
    command: `agents.${command}`,
    environment: options.environmentName ?? null,
    data,
    extra,
  });
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
};

/** Resolve the env and load its Agentic Studio session. */
export const prepare = async (
  options: RunAgentsBaseOptions
): Promise<{ logger: Logger; session: AgentsSession; envName: string }> => {
  const logger = toLogger(options);
  const { session, envName } = await resolveAgentsSession(options);
  return { logger, session, envName };
};

/**
 * Shared list rendering. JSON path emits a `ScaiEnvelope`; human
 * path emits one line per item. `command` is the agents-suffix
 * (e.g. `agent.list`) — the helper prefixes `agents.` for the
 * envelope.
 */
export interface RenderListArgs<T> {
  logger: Logger;
  command: string;
  options: RunAgentsBaseOptions;
  label: string;
  items: T[];
  line: (item: T) => string;
}

export const renderList = <T>(args: RenderListArgs<T>): void => {
  const { logger, command, options, label, items, line } = args;
  if (logger.isJson()) {
    writeAgentsEnvelope(command, options, items);
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

/** Shared single-item rendering — envelope on `--json`, key/value list otherwise. */
export const renderItem = (
  logger: Logger,
  command: string,
  options: RunAgentsBaseOptions,
  label: string,
  item: Record<string, unknown>
): void => {
  if (logger.isJson()) {
    writeAgentsEnvelope(command, options, item);
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
