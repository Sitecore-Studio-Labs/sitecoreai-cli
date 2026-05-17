import path from "node:path";
import { resolveEnvironment } from "@/policy/environment";
import { createScaiError } from "@/shared/errors";
import { buildScaiEnvelope, readScaiEnvelopeFromStdin } from "@/shared/envelope";
import { openBaseline } from "../../baseline";
import { type HygieneCommonOptions, toLogger } from "../shared";
import { auditNames } from "./all";
import { runAuditAll } from "./all";

/**
 * `scai hygiene audit baseline <show|create|remove|reset>` task runners.
 *
 * Baseline files live at `.scai/audit-baseline-<envName>.json` and
 * record the set of audit findings that should be ignored by future
 * runs that pass `--baseline`. See `src/hygiene/baseline.ts` for the
 * file shape and fingerprinting rules.
 */

export type BaselineShowOptions = HygieneCommonOptions;

export interface BaselineCreateOptions extends HygieneCommonOptions {
  /** Comma-separated audit names. Default: all. */
  audits?: string[];
  /** Replace existing entries instead of merging. Default false (merge). */
  reset?: boolean;
  root?: string;
  limit?: number;
  includeSystem?: boolean;
}

export interface BaselineRemoveOptions extends HygieneCommonOptions {
  /** Audit name. */
  audit: string;
  /** Fingerprint to remove (from `baseline show`). */
  fingerprint: string;
}

export interface BaselineResetOptions extends HygieneCommonOptions {
  /** Audit name to reset. Default: all audits. */
  audit?: string;
}

export interface BaselineAcceptOptions extends HygieneCommonOptions {
  /** Audit name the findings belong to (must match the audit that produced the envelope). */
  audit?: string;
  /** Optional note recorded with every accepted entry. */
  note?: string;
  /**
   * Read a `ScaiEnvelope` from stdin and add every finding in
   * `envelope.data` to the baseline. The only ingestion mode in v1 —
   * future shapes (e.g. `--all-current` to run the audit live and
   * accept everything) can layer on top of the same library
   * function.
   */
  fromStdin?: boolean;
}

const resolveConfigDir = (options: HygieneCommonOptions): string => {
  if (!options.config) return process.cwd();
  if (options.config.endsWith(".json")) return path.dirname(options.config);
  return options.config;
};

export const runBaselineShow = async (options: BaselineShowOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const baseline = openBaseline({
    envName,
    configDir: resolveConfigDir(options),
    logger,
  });
  const snapshot = baseline.snapshot();
  const totalEntries = Object.values(snapshot.ignored).reduce((n, list) => n + list.length, 0);
  if (logger.isJson()) {
    logger.json({
      command: "audit.baseline.show",
      environment: envName,
      filePath: baseline.filePath,
      totalEntries,
      ignored: snapshot.ignored,
    });
    return;
  }
  logger.info(`Baseline: ${baseline.filePath}`);
  logger.info(`${totalEntries} entr${totalEntries === 1 ? "y" : "ies"} ignored.`);
  for (const [audit, list] of Object.entries(snapshot.ignored)) {
    if (!list.length) continue;
    logger.info(`  ${audit}: ${list.length}`);
    for (const e of list.slice(0, 5)) {
      logger.info(`    ${e.fingerprint}${e.note ? ` — ${e.note}` : ""}`);
    }
    if (list.length > 5) logger.info(`    … +${list.length - 5} more`);
  }
};

export const runBaselineCreate = async (options: BaselineCreateOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const configDir = resolveConfigDir(options);
  const baseline = openBaseline({ envName, configDir, logger });

  if (options.reset) {
    // Wipe existing audit entries we're about to refresh.
    const snap = baseline.snapshot();
    const target = options.audits?.length ? options.audits : auditNames();
    for (const a of target) {
      for (const e of snap.ignored[a] ?? []) baseline.remove(a, e.fingerprint);
    }
  }

  // Run the chosen audits and add every finding to the baseline.
  await runAuditAll({
    ...options,
    include: options.audits,
    updateBaseline: true,
    json: true,
    quiet: true,
  });

  logger.info(`Baseline ${options.reset ? "reset" : "updated"} at ${baseline.filePath}`, "green");
};

export const runBaselineRemove = async (options: BaselineRemoveOptions): Promise<void> => {
  const logger = toLogger(options);
  if (!options.audit || !options.fingerprint) {
    throw createScaiError("Both --audit and --fingerprint are required.", "INPUT_INVALID");
  }
  const { envName } = resolveEnvironment(options);
  const baseline = openBaseline({
    envName,
    configDir: resolveConfigDir(options),
    logger,
  });
  baseline.remove(options.audit, options.fingerprint);
  await baseline.flush();
  logger.info(
    `Removed ${options.audit}/${options.fingerprint} from baseline ${baseline.filePath}`,
    "green"
  );
};

export const runBaselineReset = async (options: BaselineResetOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const baseline = openBaseline({
    envName,
    configDir: resolveConfigDir(options),
    logger,
  });
  const snap = baseline.snapshot();
  const target = options.audit ? [options.audit] : Object.keys(snap.ignored);
  let removed = 0;
  for (const a of target) {
    for (const e of snap.ignored[a] ?? []) {
      baseline.remove(a, e.fingerprint);
      removed += 1;
    }
  }
  await baseline.flush();
  logger.info(
    `Removed ${removed} entr${removed === 1 ? "y" : "ies"} from ${baseline.filePath}`,
    "green"
  );
};

/**
 * `scai hygiene audit baseline accept --audit <name> --from-stdin` — read a
 * `ScaiEnvelope` from stdin (typically the output of an audit's
 * `--json` mode) and mark every finding in `envelope.data` as
 * accepted in the per-env baseline.
 *
 * Closes the agent-friendly loop the feedback agent called out:
 * baseline was underused because there was no fast way to say "yes,
 * everything I just saw is intentional." Pair with the canonical
 * envelope (every audit emits one) and you get a one-pipeline
 * answer:
 *
 *   $ scai hygiene audit broken-links list --json \
 *     | scai hygiene audit baseline accept --audit broken-links --note "known debt"
 *
 * Skips fingerprints that are already in the baseline so the
 * pipeline is idempotent.
 */
export const runBaselineAccept = async (options: BaselineAcceptOptions): Promise<void> => {
  const logger = toLogger(options);
  if (!options.audit) {
    throw createScaiError("audit baseline accept requires --audit <name>.", "INPUT_INVALID");
  }
  if (!options.fromStdin) {
    throw createScaiError(
      "audit baseline accept requires --from-stdin (pipe an audit --json envelope).",
      "INPUT_INVALID",
      {
        hint: "Run e.g. `scai hygiene audit broken-links list --json | scai hygiene audit baseline accept --audit broken-links`.",
      }
    );
  }

  const envelope = await readScaiEnvelopeFromStdin<unknown[]>();
  if (!Array.isArray(envelope.data)) {
    throw createScaiError(
      `audit baseline accept: stdin envelope.data is not an array (got ${typeof envelope.data}).`,
      "INPUT_INVALID"
    );
  }

  const { envName } = resolveEnvironment(options);
  const baseline = openBaseline({
    envName,
    configDir: resolveConfigDir(options),
    logger,
  });

  let added = 0;
  let alreadyPresent = 0;
  for (const finding of envelope.data) {
    if (baseline.isIgnored(options.audit, finding)) {
      alreadyPresent += 1;
      continue;
    }
    baseline.add(options.audit, finding, options.note);
    added += 1;
  }
  await baseline.flush();

  const summary = `Accepted ${added} new finding${added === 1 ? "" : "s"} into baseline ${baseline.filePath}${
    alreadyPresent > 0 ? ` (${alreadyPresent} already present, skipped)` : ""
  }.`;

  if (logger.isJson()) {
    logger.json(
      buildScaiEnvelope({
        command: "audit.baseline.accept",
        environment: envName,
        data: {
          audit: options.audit,
          added,
          alreadyPresent,
          filePath: baseline.filePath,
          sourceCommand: envelope.command,
        },
        extra: { summary },
      })
    );
    return;
  }
  logger.info(summary, added > 0 ? "green" : "gray");
};
