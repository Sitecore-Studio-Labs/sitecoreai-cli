import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  extractInternalRefs,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface AuditBrokenLinksOptions extends HygieneCommonOptions {
  /**
   * Limit the scan to descendants of this content-tree path (or itemId).
   * Defaults to `/sitecore/content` — most authored content lives there
   * and scanning the full master DB is rarely useful.
   */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  /** Opt-in to the on-disk field cache for this run. */
  cache?: boolean;
}

export interface BrokenLinkReport {
  itemId: string;
  path: string;
  templateName?: string | null;
  language?: string | null;
  brokenRefs: Array<{ fieldName: string; refItemId: string }>;
}

/**
 * Audit content for internal links that target items that don't exist.
 *
 * Strategy (XM Cloud Authoring API only — no direct link-database query):
 *
 *   1. Use `scanItemsAndFields` to page through `search` and batch-fetch
 *      fields. The helper applies the active perf knobs (concurrency,
 *      batchSize, pageParallelism) and the optional on-disk field cache.
 *   2. Run `extractInternalRefs` over field values to collect referenced
 *      itemIds (RichText `<link>` tags, bare GUIDs, pipe-delimited
 *      Multilist values).
 *   3. Resolve refs in bulk via `itemsExistBatch` — same concurrency as
 *      field reads.
 *   4. Emit a report row for every (item, field, ref) where ref doesn't
 *      resolve.
 *
 * Notes:
 *   - Scoped to **internal** Sitecore item refs only — external URLs
 *     and media refs aren't surfaced here. `audit unused-media list`
 *     handles the media side.
 *   - The dotnet `Sitecore.DevEx` plugin had access to the SQL-backed
 *     link database, which is O(N) in references rather than O(N) in
 *     items + O(R) in refs. The Authoring GraphQL path is fundamentally
 *     more expensive, hence the `--limit` cap.
 */
export const runAuditBrokenLinks = async (
  options: AuditBrokenLinksOptions
): Promise<BrokenLinkReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";

  const { scanned, fieldsByItemId, cache, knobs } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  // Collect every referenced itemId across all scanned items. De-dup to
  // avoid asking the API more than once for the same id.
  const allRefs = new Set<string>();
  type Pending = { itemId: string; path: string; fieldName: string; refItemId: string };
  const pendingRefs: Pending[] = [];
  const scannedById = new Map(scanned.map((s) => [s.itemId, s]));
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field.value) continue;
      if (field.name.startsWith("__") && field.name !== "__Source Item") continue;
      const refs = extractInternalRefs(field.value);
      for (const ref of refs) {
        if (ref === item.itemId) continue;
        allRefs.add(ref);
        pendingRefs.push({
          itemId: item.itemId,
          path: item.path,
          fieldName: field.name,
          refItemId: ref,
        });
      }
    }
  }

  // Resolve refs in batches with the same perf knobs.
  const refExists = new Map<string, boolean>();
  const refIds = Array.from(allRefs);
  const refBatches: string[][] = [];
  for (let i = 0; i < refIds.length; i += knobs.batchSize) {
    refBatches.push(refIds.slice(i, i + knobs.batchSize));
  }
  const existResults = await mapWithConcurrency(
    refBatches,
    (ids) => client.itemsExistBatch(ids),
    knobs.concurrency
  );
  for (const m of existResults) {
    for (const [id, exists] of m) refExists.set(id, exists);
  }

  // Build per-item broken-link reports.
  const byItem = new Map<string, BrokenLinkReport>();
  for (const p of pendingRefs) {
    if (refExists.get(p.refItemId) !== false) continue;
    const meta = scannedById.get(p.itemId);
    if (!meta) continue;
    const existing = byItem.get(p.itemId);
    if (existing) {
      existing.brokenRefs.push({ fieldName: p.fieldName, refItemId: p.refItemId });
    } else {
      byItem.set(p.itemId, {
        itemId: p.itemId,
        path: meta.path,
        templateName: meta.templateName,
        language: meta.language,
        brokenRefs: [{ fieldName: p.fieldName, refItemId: p.refItemId }],
      });
    }
  }
  const reports = Array.from(byItem.values()).sort((a, b) => a.path.localeCompare(b.path));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.broken-links.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} with broken internal links.`,
    formatLine: (r) =>
      `${r.path} (${r.brokenRefs.length} broken: ${r.brokenRefs
        .slice(0, 3)
        .map((b) => `${b.fieldName}→${b.refItemId.slice(0, 8)}`)
        .join(", ")}${r.brokenRefs.length > 3 ? "…" : ""})`,
    extra: { root, scannedCount: scanned.length },
  });

  return reports;
};
