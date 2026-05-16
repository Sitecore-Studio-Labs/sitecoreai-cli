import type { PublishJob } from "./api/types";

/**
 * Structured failure information extracted from a `PublishJob`'s
 * normalized + raw payloads. The Publishing API does not document a
 * single canonical "failure detail" field — observed shapes include:
 *
 *   - `statistics.itemsFailed` (count of failed items)
 *   - `statistics.xmc.errors[]` (per-item error messages — observed
 *     shape: `{ itemId, locale?, message }`, defensive parsing only)
 *   - `system.failureReason` (free-text, sometimes present)
 *   - `system.canceledBy.name` / `system.canceledBy.id` (set on cancel,
 *     not failure, but useful in the same diagnostic block)
 *
 * Callers should treat every field as optional — older XM Cloud
 * deployments and certain failure classes don't populate all of them.
 *
 * This module is the single source of truth for "how do we explain a
 * failed publish to the operator." Both `publish status` and the
 * `publish status --watch` exit path consume it; future surfaces (MCP
 * `publishing_lifecycle`, audit-log readers) should reuse it rather
 * than re-derive the same fields.
 */
export interface PublishJobFailureDiagnostics {
  /** Free-text failure reason from `system.failureReason` if present. */
  reason?: string;
  /** Count of failed items, when statistics expose it. */
  failedItemCount?: number;
  /** Per-item failure messages, defensively parsed. */
  itemFailures?: Array<{ itemId?: string; locale?: string; message: string }>;
  /** Last statistics-update timestamp; helps gauge how stale stats are. */
  lastReportTime?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseItemFailures = (
  stats: Record<string, unknown>
): Array<{ itemId?: string; locale?: string; message: string }> | undefined => {
  // Two candidate shapes — defensive, neither guaranteed:
  //   stats.errors:      [{ itemId, locale, message }]
  //   stats.xmc.errors:  same
  const candidates: unknown[] = [];
  if (Array.isArray(stats.errors)) {
    candidates.push(...stats.errors);
  }
  const xmc = asRecord(stats.xmc);
  if (xmc && Array.isArray(xmc.errors)) {
    candidates.push(...xmc.errors);
  }
  if (candidates.length === 0) {
    return undefined;
  }
  const parsed = candidates
    .map((c): { itemId?: string; locale?: string; message: string } | undefined => {
      const rec = asRecord(c);
      if (!rec) {
        return undefined;
      }
      const message = asString(rec.message) ?? asString(rec.error) ?? asString(rec.detail);
      if (!message) {
        return undefined;
      }
      return {
        itemId: asString(rec.itemId) ?? asString(rec.id),
        locale: asString(rec.locale) ?? asString(rec.language),
        message,
      };
    })
    .filter((v): v is { itemId?: string; locale?: string; message: string } => v !== undefined);
  return parsed.length > 0 ? parsed : undefined;
};

export const extractFailureDiagnostics = (job: PublishJob): PublishJobFailureDiagnostics => {
  const raw = job.raw;
  const stats = asRecord(raw.statistics) ?? {};
  const system = asRecord(raw.system) ?? {};

  return {
    reason:
      asString(system.failureReason) ??
      asString((stats.xmc as Record<string, unknown> | undefined)?.failureReason),
    failedItemCount: asNumber(stats.itemsFailed) ?? asNumber(stats.failedCount),
    itemFailures: parseItemFailures(stats),
    lastReportTime: asString(stats.lastReportTime),
  };
};

/**
 * Render the diagnostics as a list of human-readable lines suitable
 * for sequential `logger.info()` calls. Returns `[]` when nothing
 * useful can be said — the caller should not print a "Failure:"
 * header in that case.
 */
export const formatFailureDiagnostics = (diag: PublishJobFailureDiagnostics): string[] => {
  const lines: string[] = [];
  if (diag.reason) {
    lines.push(`Reason: ${diag.reason}`);
  }
  if (diag.failedItemCount !== undefined && diag.failedItemCount > 0) {
    lines.push(`Failed items: ${diag.failedItemCount}`);
  }
  if (diag.itemFailures && diag.itemFailures.length > 0) {
    const max = 10;
    for (const f of diag.itemFailures.slice(0, max)) {
      const tag = f.itemId
        ? `${f.itemId}${f.locale ? ` (${f.locale})` : ""}`
        : (f.locale ?? "(unknown item)");
      lines.push(`  ${tag}: ${f.message}`);
    }
    if (diag.itemFailures.length > max) {
      lines.push(`  (and ${diag.itemFailures.length - max} more)`);
    }
  }
  if (diag.lastReportTime) {
    lines.push(`Last statistics update: ${diag.lastReportTime}`);
  }
  return lines;
};
