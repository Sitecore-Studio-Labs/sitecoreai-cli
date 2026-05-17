import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { readRecentPublishAudit, type PublishAuditEntry } from "@/shared/publish-audit";

export interface RunPublishHistoryOptions {
  /** Filter to entries from this env name. */
  env?: string;
  /** ISO 8601 timestamp OR relative spec (e.g. `7d`, `24h`, `30m`). */
  since?: string;
  /** Substring match against the `command` field
   *  (e.g. `"item"`, `"unpublish"`, `"content version"`). */
  command?: string;
  /** Filter by outcome. */
  outcome?: PublishAuditEntry["outcome"];
  /** Max entries to read from disk before filtering. Default 500. */
  scanLimit?: number;
  /** Max entries to print after filtering. Default 50. */
  limit?: number;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

const toLogger = (options: RunPublishHistoryOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

/**
 * Parse `--since`. Accepts:
 *   - ISO 8601 (`2026-05-14T00:00:00Z`)
 *   - Relative (`24h`, `7d`, `30m`) — interpreted as "this much time ago"
 *
 * Returns the absolute ISO timestamp to compare against, or `undefined`
 * if the spec is empty. Throws INPUT_INVALID on a malformed spec rather
 * than silently returning everything — operators shouldn't think their
 * filter is in effect when it isn't.
 */
const parseSince = (raw: string | undefined): string | undefined => {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  const value = raw.trim();
  const relative = value.match(/^(\d+)\s*(m|h|d)$/i);
  if (relative) {
    const n = Number.parseInt(relative[1], 10);
    const unit = relative[2].toLowerCase();
    const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createScaiError(`Could not parse --since '${value}'.`, "INPUT_INVALID", {
      hint: "Pass an ISO 8601 timestamp (e.g. 2026-05-01T00:00:00Z) or a relative spec like 24h / 7d / 30m.",
    });
  }
  return date.toISOString();
};

const formatRow = (entry: PublishAuditEntry): string => {
  const ts = entry.ts;
  const env = (entry.scope?.envName ?? "?").padEnd(12);
  const cmd = entry.command.padEnd(34);
  const outcome = entry.outcome === "ok" ? "ok" : entry.outcome === "error" ? "ERROR" : "cxl";
  const job = entry.jobId ? entry.jobId.slice(0, 14) : "—";
  const err = entry.outcome === "error" && entry.errorCode ? `  ${entry.errorCode}` : "";
  return `${ts}  ${env}  ${cmd}  ${outcome.padEnd(5)}  ${job.padEnd(14)}${err}`;
};

export const runPublishHistory = async (options: RunPublishHistoryOptions): Promise<void> => {
  const logger = toLogger(options);
  const since = parseSince(options.since);
  const scanLimit = options.scanLimit ?? 500;
  const limit = options.limit ?? 50;

  const all = readRecentPublishAudit(scanLimit);
  const filtered = all.filter((entry) => {
    if (since && entry.ts < since) {
      return false;
    }
    if (options.env && entry.scope?.envName !== options.env) {
      return false;
    }
    if (options.command && !entry.command.includes(options.command)) {
      return false;
    }
    if (options.outcome && entry.outcome !== options.outcome) {
      return false;
    }
    return true;
  });

  const trimmed = filtered.slice(-limit);

  if (logger.isJson()) {
    for (const entry of trimmed) {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    }
    return;
  }

  if (trimmed.length === 0) {
    logger.info("No matching audit entries.", "yellow");
    return;
  }

  logger.info(
    `Publishing audit (${trimmed.length} entr${trimmed.length === 1 ? "y" : "ies"}):`,
    "cyan"
  );
  logger.info(
    `${"timestamp".padEnd(24)}  ${"env".padEnd(12)}  ${"command".padEnd(34)}  ${"out".padEnd(5)}  ${"jobId".padEnd(14)}`,
    "gray"
  );
  for (const entry of trimmed) {
    logger.info(formatRow(entry));
  }
};
