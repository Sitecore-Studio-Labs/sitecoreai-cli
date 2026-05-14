import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Publishing audit log — append-only JSON-Lines at
 * `~/.sitecoreai/audit.log` (configurable via SITECOREAI_AUDIT_LOG).
 *
 * The audit log is the production trail for `scai publish` operations.
 * Every call writes one line; lines are never redacted (that's the
 * point — when content goes live, the operator needs to be able to
 * explain how). Different from `~/.sitecoreai/cli-history.log` in two
 * ways:
 *
 *   1. cli-history is per-command (start/success/error events for any
 *      `scai *` invocation) with secrets redacted; audit is per-publish
 *      with consent records and resolved scope kept verbatim.
 *   2. audit lines have higher retention expectations — operators
 *      should treat this file like a SOC-relevant artifact.
 *
 * Failure mode: if the audit log can't be written (no write access,
 * disk full, etc.) the publish call MUST fail rather than silently
 * proceed without trail. The whole safety design relies on the log
 * being trustworthy.
 */

export type PublishAuditCaller =
  | { type: "human"; via: "cli" | "mcp-prompt"; identityHint?: string }
  | { type: "ci"; pipelineId: string; commitSha?: string; gateName?: string };

export interface PublishAuditScope {
  envName: string;
  resolvedTenantId?: string;
  target: string;
  /** Either "item" (Tier 1) or "full" (Tier 2). */
  kind: "item" | "full";
  /** Resolved item ids for Tier 1; undefined for Tier 2. */
  itemIds?: string[];
  /** Item path / subtree root for Tier 1 if known. */
  path?: string;
  languages?: string[];
  includeSubitems?: boolean;
  includeRelated?: boolean;
}

export interface PublishAuditEntry {
  ts: string;
  command: "publish item" | "publish all" | "publish cancel";
  caller: PublishAuditCaller;
  scope: PublishAuditScope;
  /** "high" for Tier 2 publish-all, "normal" for Tier 1. Grep-able. */
  risk: "normal" | "high";
  /** Hash of (envName, kind, itemIds, languages, target) — same hash
   *  used in the scope token. Lets operators correlate dry-run output
   *  with the actual publish call later. */
  scopeHash: string;
  /** Scope token used at the real call (if any). */
  scopeToken?: string;
  /** Sitecore-side job id once the API responded. Absent on errors. */
  jobId?: string;
  /** Final state from the API: completed | failed | cancelled | error. */
  outcome: "ok" | "error" | "cancelled";
  /** ScaiError code when outcome is "error". */
  errorCode?: string;
  /** Human-readable error message when outcome is "error". */
  errorMessage?: string;
}

const DEFAULT_AUDIT_PATH = path.join(os.homedir(), ".sitecoreai", "audit.log");

const resolveAuditPath = (): string =>
  process.env.SITECOREAI_AUDIT_LOG?.trim() || DEFAULT_AUDIT_PATH;

/**
 * Append a single audit entry. Throws if the file can't be written —
 * intentional: silently dropping an audit entry would undermine the
 * whole safety design.
 */
export const recordPublishAudit = (entry: PublishAuditEntry): void => {
  const auditPath = resolveAuditPath();
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, "utf8");
};

/**
 * Read recent audit entries (newest last). Used by `scai publish
 * status` to surface running jobs when no job id is provided (since
 * the GraphQL surface doesn't expose a list-jobs endpoint and the
 * REST API requires per-call scope checks).
 *
 * `limit` caps the number of returned entries; the file is scanned
 * tail-first so old entries don't have to be parsed when only the
 * recent ones are needed.
 */
export const readRecentPublishAudit = (limit = 50): PublishAuditEntry[] => {
  const auditPath = resolveAuditPath();
  if (!fs.existsSync(auditPath)) {
    return [];
  }
  const raw = fs.readFileSync(auditPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const tail = lines.slice(-limit);
  const entries: PublishAuditEntry[] = [];
  for (const line of tail) {
    try {
      entries.push(JSON.parse(line) as PublishAuditEntry);
    } catch {
      // Skip malformed lines — corrupted writes don't poison reads.
    }
  }
  return entries;
};
