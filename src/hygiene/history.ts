import fs from "node:fs";
import path from "node:path";
import { createScaiError } from "@/shared/errors";
import { Logger } from "@/shared/logger";
import { fingerprintFinding } from "./baseline";

/**
 * Audit history — snapshots of `audit all` results over time, used
 * for trend tracking ("did broken-links count go up this week?").
 *
 * Distinct from baselines (an ignore-list of accepted findings).
 * History is a journal — every snapshot is preserved, and the diff
 * command computes per-audit deltas between two snapshots.
 *
 * Storage: `.scai/audit-history/<envName>-<datetime>.json` containing
 * the full audit-all envelope. One file per capture.
 */

const HISTORY_VERSION = 1;

export interface HistorySnapshot {
  version: number;
  envName: string;
  capturedAt: string;
  /** Map of audit-name → list of findings (fingerprints + a sample). */
  audits: Record<string, Array<{ fingerprint: string; sample?: Record<string, unknown> }>>;
}

export interface SnapshotEntry {
  filePath: string;
  capturedAt: string;
}

const resolveHistoryDir = (envName: string, configDir: string): string => {
  const safeName = envName.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(configDir, ".scai", "audit-history", safeName);
};

const formatTimestamp = (date: Date): string => {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
};

export interface CaptureAuditAllEnvelope {
  audits?: Record<
    string,
    { findings?: unknown[]; ignoredCount?: number; durationMs?: number; error?: string }
  >;
}

/**
 * Take an `audit all` envelope and persist it as a history snapshot.
 * Returns the full path to the snapshot file.
 */
export const captureHistory = (params: {
  envName: string;
  configDir: string;
  envelope: CaptureAuditAllEnvelope;
  logger?: Logger;
  now?: Date;
}): string => {
  const now = params.now ?? new Date();
  const dir = resolveHistoryDir(params.envName, params.configDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${formatTimestamp(now)}.json`);

  const snapshot: HistorySnapshot = {
    version: HISTORY_VERSION,
    envName: params.envName,
    capturedAt: now.toISOString(),
    audits: {},
  };
  for (const [auditName, info] of Object.entries(params.envelope.audits ?? {})) {
    const findings = info.findings ?? [];
    snapshot.audits[auditName] = findings.map((f) => ({
      fingerprint: fingerprintFinding(auditName, f),
      sample: extractSampleFields(f),
    }));
  }
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  params.logger?.verbose(`Captured snapshot: ${file}`);
  return file;
};

/**
 * Pull a small sample of identifying fields (path, itemId, etc.) for
 * the snapshot so `audit-history diff` can show human-readable rows
 * without storing the full finding payload.
 */
const extractSampleFields = (finding: unknown): Record<string, unknown> | undefined => {
  if (!finding || typeof finding !== "object") return undefined;
  const f = finding as Record<string, unknown>;
  const sample: Record<string, unknown> = {};
  for (const key of ["path", "itemId", "name", "user", "contentHash", "templateId", "archivalId"]) {
    if (f[key] !== undefined) sample[key] = f[key];
  }
  return Object.keys(sample).length > 0 ? sample : undefined;
};

/** List history snapshots for an env, newest first. */
export const listHistory = (params: { envName: string; configDir: string }): SnapshotEntry[] => {
  const dir = resolveHistoryDir(params.envName, params.configDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { filePath: full, capturedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
};

export const loadSnapshot = (filePath: string): HistorySnapshot => {
  if (!fs.existsSync(filePath)) {
    throw createScaiError(`Snapshot not found: ${filePath}`, "CONFIG_NOT_FOUND");
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as HistorySnapshot;
    if (parsed.version !== HISTORY_VERSION) {
      throw createScaiError(
        `Snapshot version mismatch: ${parsed.version} vs expected ${HISTORY_VERSION} (${filePath})`,
        "CONFIG_INVALID"
      );
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: unknown }).code === "CONFIG_INVALID"
    ) {
      throw error;
    }
    throw createScaiError(
      `Failed to read snapshot: ${error instanceof Error ? error.message : String(error)}`,
      "CONFIG_INVALID"
    );
  }
};

export interface DiffSummary {
  fromCapturedAt: string;
  toCapturedAt: string;
  perAudit: Record<
    string,
    {
      total: { from: number; to: number; delta: number };
      added: Array<{ fingerprint: string; sample?: Record<string, unknown> }>;
      removed: Array<{ fingerprint: string; sample?: Record<string, unknown> }>;
    }
  >;
  totals: { added: number; removed: number; net: number };
}

/**
 * Compute a delta between two snapshots: items added (present in
 * `to` but not `from`) and removed (vice versa), grouped by audit.
 * Identity is by fingerprint, same as baselines.
 */
export const diffSnapshots = (from: HistorySnapshot, to: HistorySnapshot): DiffSummary => {
  const auditNames = new Set([...Object.keys(from.audits), ...Object.keys(to.audits)]);
  const perAudit: DiffSummary["perAudit"] = {};
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const name of auditNames) {
    const fromFindings = from.audits[name] ?? [];
    const toFindings = to.audits[name] ?? [];
    const fromFps = new Set(fromFindings.map((f) => f.fingerprint));
    const toFps = new Set(toFindings.map((f) => f.fingerprint));
    const added = toFindings.filter((f) => !fromFps.has(f.fingerprint));
    const removed = fromFindings.filter((f) => !toFps.has(f.fingerprint));
    perAudit[name] = {
      total: {
        from: fromFindings.length,
        to: toFindings.length,
        delta: toFindings.length - fromFindings.length,
      },
      added,
      removed,
    };
    totalAdded += added.length;
    totalRemoved += removed.length;
  }
  return {
    fromCapturedAt: from.capturedAt,
    toCapturedAt: to.capturedAt,
    perAudit,
    totals: { added: totalAdded, removed: totalRemoved, net: totalAdded - totalRemoved },
  };
};
