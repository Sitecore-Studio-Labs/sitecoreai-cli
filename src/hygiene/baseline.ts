import fs from "node:fs";
import path from "node:path";
import { createScaiError } from "@/shared/errors";
import { Logger } from "@/shared/logger";

/**
 * Per-env audit baseline.
 *
 * Records the set of findings that an operator has explicitly chosen
 * to "accept" — usually known-debt items that aren't going to be fixed
 * right now but shouldn't fail CI. When an audit runs with `--baseline`,
 * findings that match a recorded entry are filtered out of the report.
 *
 * **File location.** `.scai/audit-baseline-<envName>.json` in the
 * project root (same dir as `sitecoreai.cli.json`). One file per env
 * keeps sandbox/prod independent — sandbox can ignore experimental
 * debt that prod must still catch.
 *
 * **Identity model.** Each audit emits a different shape of finding,
 * so the baseline stores a fingerprint per finding rather than the
 * full row. The fingerprint is computed by `fingerprintFinding(audit,
 * finding)` — it picks the stable identifying fields (e.g. for
 * broken-links: itemId + fieldName + refItemId; for duplicates: just
 * contentHash). Two findings with the same fingerprint are treated as
 * equivalent.
 *
 * **What's NOT here.** History/trend tracking is Phase F — that
 * stores full snapshots over time. Baselines are an ignore-list, not
 * a journal.
 */

const BASELINE_VERSION = 1;

export interface BaselineEntry {
  /** Stable identifier derived by `fingerprintFinding`. */
  fingerprint: string;
  /** Human-readable note (optional) for why this finding was accepted. */
  note?: string;
  /** ISO date when added to the baseline. */
  addedAt: string;
}

export interface BaselineFile {
  version: number;
  envName: string;
  createdAt: string;
  /** Map of audit-name (e.g. "broken-links") → list of accepted findings. */
  ignored: Record<string, BaselineEntry[]>;
}

export interface BaselineHandle {
  envName: string;
  filePath: string;
  /** Returns true if the audit+finding is in the ignore list. */
  isIgnored(audit: string, finding: unknown): boolean;
  /** Add a finding to the ignore list. No-op if already present. */
  add(audit: string, finding: unknown, note?: string): void;
  /** Remove a finding from the ignore list. */
  remove(audit: string, fingerprint: string): void;
  /** Persist to disk. Safe to call multiple times. */
  flush(): Promise<void>;
  /** Snapshot of current state for reporting. */
  snapshot(): BaselineFile;
}

/**
 * Compute a stable fingerprint for a finding row. Each audit's
 * row shape gets its own identity rule. Falls back to a JSON hash
 * for audit names we don't know about (future-audit-tolerant).
 *
 * Why per-audit rules: an audit may carry transient fields (e.g.
 * `daysSinceUpdate` on stale-content changes every run). The
 * fingerprint MUST exclude those, otherwise baselines never match
 * and the ignore-list is useless.
 */
export const fingerprintFinding = (audit: string, finding: unknown): string => {
  if (!finding || typeof finding !== "object") {
    return hashJson({ audit, finding });
  }
  const f = finding as Record<string, unknown>;
  switch (audit) {
    case "broken-links":
      // (item, field, ref) — the actual broken edge.
      return hashJson({
        audit,
        itemId: f.itemId,
        brokenRefs: (f.brokenRefs as Array<{ fieldName: string; refItemId: string }>)?.map(
          (b) => `${b.fieldName}:${b.refItemId}`
        ),
      });
    case "unused-media":
    case "empty-items":
    case "page-design-orphans":
    case "personalization-broken":
      return hashJson({ audit, itemId: f.itemId });
    case "alt-text-missing":
      // One row per (item, field, mediaId) — the mediaId disambiguates
      // when an item has multiple Image fields with the same name in
      // different languages, and the fieldName disambiguates the common
      // case of an item with both a Banner and a Thumbnail.
      return hashJson({
        audit,
        itemId: f.itemId,
        fieldName: f.fieldName,
        mediaId: f.mediaId,
      });
    case "datasource-missing":
      return hashJson({
        audit,
        itemId: f.itemId,
        missing: (f.missingDatasources as Array<{ fieldName: string; datasource: string }>)?.map(
          (d) => `${d.fieldName}:${d.datasource}`
        ),
      });
    case "orphans":
      return hashJson({ audit, archivalId: f.archivalId });
    case "stale-workflow":
    case "stale-content":
      // Workflow/staleness — fingerprint by item, NOT by days-since (days
      // change every run; we want the ignored item to stay ignored).
      return hashJson({ audit, itemId: f.itemId, workflowState: f.workflowState ?? f.stateName });
    case "language-data":
      return hashJson({ audit, itemId: f.itemId, langs: (f.emptyLanguages as string[])?.sort() });
    case "dead-templates":
      return hashJson({ audit, templateId: f.templateId });
    case "duplicates":
      // Hash IS the identity for duplicates.
      return hashJson({ audit, contentHash: f.contentHash });
    case "find-replace":
      // Per (item, pattern) since the same item could match different
      // patterns. The pattern is part of the call, not the row, so we
      // include it via the audit name's suffix; callers should
      // qualify the audit key when adding to baseline if needed.
      return hashJson({
        audit,
        itemId: f.itemId,
        fields: (f.matches as Array<{ fieldName: string }>)?.map((m) => m.fieldName),
      });
    default:
      return hashJson({ audit, finding: f });
  }
};

const hashJson = (value: unknown): string => {
  // Stable JSON.stringify (sort keys) so identical content always hashes
  // the same. Crypto SHA-1 is fine here (we're not security-sensitive).
  const stable = stableStringify(value);
  // Use a simple FNV-1a hash — no need to pull crypto for an ignore-list
  // key. Collisions at 8-byte output are negligible at audit-finding
  // scale (< 1e6 entries per env file).
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < stable.length; i += 1) {
    h ^= BigInt(stable.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
};

const resolveBaselinePath = (envName: string, configDir: string): string => {
  const safeName = envName.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(configDir, ".scai", `audit-baseline-${safeName}.json`);
};

const loadBaseline = (filePath: string, envName: string, logger?: Logger): BaselineFile => {
  if (!fs.existsSync(filePath)) {
    return {
      version: BASELINE_VERSION,
      envName,
      createdAt: new Date().toISOString(),
      ignored: {},
    };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as BaselineFile;
    if (parsed.version !== BASELINE_VERSION || parsed.envName !== envName) {
      throw createScaiError(
        `Baseline file ${filePath} is for env '${parsed.envName}' v${parsed.version}; expected '${envName}' v${BASELINE_VERSION}.`,
        "CONFIG_INVALID"
      );
    }
    if (!parsed.ignored) parsed.ignored = {};
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: unknown }).code === "CONFIG_INVALID"
    ) {
      throw error;
    }
    logger?.warn(
      `Baseline file ${filePath} is unreadable; starting fresh. (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    return {
      version: BASELINE_VERSION,
      envName,
      createdAt: new Date().toISOString(),
      ignored: {},
    };
  }
};

export interface OpenBaselineOptions {
  envName: string;
  configDir: string;
  logger?: Logger;
}

export const openBaseline = (options: OpenBaselineOptions): BaselineHandle => {
  const filePath = resolveBaselinePath(options.envName, options.configDir);
  const file = loadBaseline(filePath, options.envName, options.logger);
  let dirty = false;

  return {
    envName: options.envName,
    filePath,
    isIgnored(audit, finding) {
      const list = file.ignored[audit];
      if (!list?.length) return false;
      const fp = fingerprintFinding(audit, finding);
      return list.some((e) => e.fingerprint === fp);
    },
    add(audit, finding, note) {
      const fp = fingerprintFinding(audit, finding);
      if (!file.ignored[audit]) file.ignored[audit] = [];
      const list = file.ignored[audit];
      if (list.some((e) => e.fingerprint === fp)) return;
      list.push({
        fingerprint: fp,
        ...(note !== undefined && { note }),
        addedAt: new Date().toISOString(),
      });
      dirty = true;
    },
    remove(audit, fingerprint) {
      const list = file.ignored[audit];
      if (!list?.length) return;
      const before = list.length;
      file.ignored[audit] = list.filter((e) => e.fingerprint !== fingerprint);
      if (file.ignored[audit].length !== before) dirty = true;
    },
    async flush() {
      if (!dirty) return;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(file, null, 2), "utf8");
      dirty = false;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(file)) as BaselineFile;
    },
  };
};

/**
 * Filter an audit's results to only NEW findings (not in baseline).
 * Returns a tuple of [kept, ignored] so the report can show both
 * counts in its summary.
 */
export const splitByBaseline = <T>(
  audit: string,
  findings: T[],
  baseline: BaselineHandle
): { kept: T[]; ignored: T[] } => {
  const kept: T[] = [];
  const ignored: T[] = [];
  for (const f of findings) {
    if (baseline.isIgnored(audit, f)) ignored.push(f);
    else kept.push(f);
  }
  return { kept, ignored };
};
