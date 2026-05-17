import path from "node:path";
import { resolveEnvironment } from "@/policy/environment";
import { createScaiError } from "@/shared/errors";
import { runAuditAll, type AuditAllOptions } from "./all";
import { captureHistory, diffSnapshots, listHistory, loadSnapshot } from "../../history";
import { type HygieneCommonOptions, toLogger } from "../shared";

/**
 * `scai hygiene audit history <capture|list|diff>` task runners.
 *
 * Snapshots live at `.scai/audit-history/<envName>/<datetime>.json`.
 * Each snapshot stores per-audit finding fingerprints + small samples
 * (no full payload), so the directory stays compact across months of
 * captures.
 */

export interface HistoryCaptureOptions extends HygieneCommonOptions {
  /** Forwarded to `audit all`. */
  root?: string;
  limit?: number;
  includeSystem?: boolean;
  index?: string;
  include?: string[];
  excludeAudit?: string[];
  exclude?: string[];
  since?: string;
}

const resolveConfigDir = (options: HygieneCommonOptions): string => {
  if (!options.config) return process.cwd();
  if (options.config.endsWith(".json")) return path.dirname(options.config);
  return options.config;
};

export const runHistoryCapture = async (options: HistoryCaptureOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const configDir = resolveConfigDir(options);

  // Capture into an in-memory envelope by running audit all with
  // --output set to a tmp file, then reading + persisting under
  // the history dir. Cleaner than refactoring runAuditAll to return
  // its envelope directly.
  const fs = await import("node:fs");
  const os = await import("node:os");
  const tmpFile = path.join(
    os.tmpdir(),
    `scai-audit-all-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );
  await runAuditAll({
    ...options,
    output: tmpFile,
    format: "json",
    quiet: true,
  } as AuditAllOptions);
  let envelope: { audits?: Record<string, { findings?: unknown[] }> };
  try {
    envelope = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
  const file = captureHistory({ envName, configDir, envelope, logger });
  if (logger.isJson()) {
    logger.json({
      command: "audit.history.capture",
      environment: envName,
      file,
      totalFindings: Object.values(envelope.audits ?? {}).reduce(
        (n, info) => n + (info.findings?.length ?? 0),
        0
      ),
    });
    return;
  }
  logger.info(`Captured snapshot: ${file}`, "green");
};

export type HistoryListOptions = HygieneCommonOptions;

export const runHistoryList = async (options: HistoryListOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const configDir = resolveConfigDir(options);
  const snapshots = listHistory({ envName, configDir });
  if (logger.isJson()) {
    logger.json({
      command: "audit.history.list",
      environment: envName,
      count: snapshots.length,
      snapshots,
    });
    return;
  }
  if (snapshots.length === 0) {
    logger.info("No snapshots yet. Run `scai hygiene audit history capture` to take one.", "green");
    return;
  }
  logger.info(`${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}:`);
  for (const s of snapshots.slice(0, 20)) {
    logger.info(`  ${s.capturedAt}  ${path.basename(s.filePath)}`);
  }
  if (snapshots.length > 20) logger.info(`  … +${snapshots.length - 20} more`);
};

export interface HistoryDiffOptions extends HygieneCommonOptions {
  /** Snapshot file path to compare FROM. Defaults to the second-most-recent. */
  from?: string;
  /** Snapshot file path to compare TO. Defaults to the most recent. */
  to?: string;
}

export const runHistoryDiff = async (options: HistoryDiffOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName } = resolveEnvironment(options);
  const configDir = resolveConfigDir(options);
  const snapshots = listHistory({ envName, configDir });
  if (snapshots.length < 2 && (!options.from || !options.to)) {
    throw createScaiError(
      `Need at least 2 snapshots to diff (have ${snapshots.length}). Run \`scai hygiene audit history capture\` first.`,
      "INPUT_INVALID"
    );
  }
  // newest first → snapshots[0] is most recent
  const toPath = options.to ?? snapshots[0].filePath;
  const fromPath = options.from ?? snapshots[1].filePath;
  const from = loadSnapshot(fromPath);
  const to = loadSnapshot(toPath);
  const diff = diffSnapshots(from, to);
  if (logger.isJson()) {
    logger.json({
      command: "audit.history.diff",
      environment: envName,
      fromFile: fromPath,
      toFile: toPath,
      ...diff,
    });
    return;
  }
  logger.info(`Diff: ${from.capturedAt} → ${to.capturedAt}`);
  logger.info(
    `Totals: +${diff.totals.added} added, -${diff.totals.removed} removed, net ${diff.totals.net >= 0 ? "+" : ""}${diff.totals.net}.`,
    diff.totals.net > 0 ? "yellow" : "green"
  );
  for (const [audit, entry] of Object.entries(diff.perAudit)) {
    const { total, added, removed } = entry;
    if (added.length === 0 && removed.length === 0) continue;
    const sign = total.delta > 0 ? "+" : total.delta < 0 ? "" : "±";
    logger.info(
      `  ${audit}: ${total.from} → ${total.to} (${sign}${total.delta})`,
      total.delta > 0 ? "yellow" : total.delta < 0 ? "green" : undefined
    );
    for (const a of added.slice(0, 3)) {
      logger.info(`    + ${a.sample?.path ?? a.fingerprint.slice(0, 12)}`);
    }
    for (const r of removed.slice(0, 3)) {
      logger.info(`    - ${r.sample?.path ?? r.fingerprint.slice(0, 12)}`);
    }
  }
};
