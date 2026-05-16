import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Publishing audit log — append-only JSON-Lines at
 * `~/.sitecoreai/audit.log` (configurable via SITECOREAI_AUDIT_LOG).
 *
 * The audit log is the production trail for `scai content publish` operations.
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

/**
 * `kind` enumerates the scope shape — each value pins the type of
 * destructive operation the scope describes. Used by the scope-token
 * `verifyScopeToken` check so a token minted for one verb can't be
 * replayed against another:
 *
 *   - `"item"`           — Tier 1 `scai content publish item` (item-list publish).
 *   - `"full"`           — Tier 2 `scai content publish all` (whole-tenant).
 *   - `"unpublish"`      — `scai content publish unpublish` (content-state
 *                          change + publish job composite).
 *   - `"validity"`       — `scai content version set-validity`
 *                          (per-version `__Valid from/to` field write).
 *   - `"never-publish"`  — `scai content version set-never-publish`
 *                          (per-version `__Never publish` field write).
 */
export type PublishAuditScopeKind = "item" | "full" | "unpublish" | "validity" | "never-publish";

/**
 * Strategy applied by `scai content publish unpublish`. The CLI exposes three
 * mechanisms, all of which leave a different audit trail:
 *
 *   - `"never-publish"` — sets `__Never publish: true`. Reversible
 *                         (clear the field + republish).
 *   - `"expire-now"`    — sets `__Valid to: now`. Reversible (write a
 *                         future date back).
 *   - `"delete"`        — calls Authoring `deleteItem`. NOT reversible
 *                         from scai's side. Production-tier gates add
 *                         a typed-item-path confirmation on top of the
 *                         normal scope-token flow.
 */
export type UnpublishStrategy = "never-publish" | "expire-now" | "delete";

export interface PublishAuditScope {
  envName: string;
  resolvedTenantId?: string;
  target: string;
  /** See `PublishAuditScopeKind` for the enumerated set. */
  kind: PublishAuditScopeKind;
  /** Resolved item ids for Tier 1 / unpublish / content version verbs;
   *  undefined for Tier 2 (whole-tenant publish). */
  itemIds?: string[];
  /** Item path / subtree root if known. Tier 1 + content version verbs
   *  often have an authored path the operator typed; the audit log
   *  keeps it for grep-ability. */
  path?: string;
  languages?: string[];
  includeSubitems?: boolean;
  includeRelated?: boolean;
  /** For `kind: "unpublish"` — which removal strategy is being applied.
   *  Distinguishes the reversible (`never-publish`, `expire-now`) from
   *  the destructive (`delete`) cases at the audit-log level. */
  strategy?: UnpublishStrategy;
  /** For `kind: "validity"` / `"never-publish"` — the specific version
   *  the field write targets (undefined for "latest"). Included in the
   *  scope hash so a dry-run on v3 can't replay against v4. */
  version?: number;
}

/**
 * Per-field change recorded on a content-state mutation. The audit log
 * stores both the resolved before-value and the after-value so an
 * operator can reverse a mistaken toggle by reading the log — no need
 * to inspect the live tenant first.
 */
export interface PublishAuditFieldChange {
  name: string;
  /** Field value as Sitecore returned it before the write. `null` when
   *  the field wasn't present on the version (Sitecore treats absent
   *  fields as effectively empty). */
  before: string | null;
  /** Field value after the write — what `updateItem` was asked to set.
   *  `null` represents an intentional clear (`--clear-valid-from`). */
  after: string | null;
}

export interface PublishAuditEntry {
  ts: string;
  command:
    | "publish item"
    | "publish all"
    | "publish cancel"
    | "publish unpublish"
    | "content version set-validity"
    | "content version set-never-publish"
    | "content version inspect";
  caller: PublishAuditCaller;
  scope: PublishAuditScope;
  /** "high" for whole-tenant or destructive operations, "normal" for
   *  scoped reversible operations. Grep-able. */
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
  /** Before/after field values for content-state mutations. Empty /
   *  undefined on publish-only commands. Populated by:
   *    - `publish unpublish` — one entry per (item, language) pair
   *      whose state field was rewritten.
   *    - `content version set-validity` — entries for `__Valid from`
   *      and/or `__Valid to`.
   *    - `content version set-never-publish` — entry for
   *      `__Never publish`.
   *  Reading the log gives the operator everything they need to
   *  manually reverse a mistaken toggle.
   */
  fieldChanges?: PublishAuditFieldChange[];
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
 * Read recent audit entries (newest last). Used by `scai content publish
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
