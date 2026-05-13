import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  extractInternalRefs,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditBrokenLinksOptions extends HygieneCommonOptions {
  /**
   * Limit the scan to descendants of this content-tree path (or itemId).
   * Defaults to `/sitecore/content` — most authored content lives there
   * and scanning the full master DB is rarely useful.
   */
  root?: string;
  /** Override the search index. Defaults to `sitecore_master_index`. */
  index?: string;
  /** Maximum number of items to scan. Default 5000 — guards against very large tenants. */
  limit?: number;
  /** Include `/sitecore/system` items in the scan. Off by default. */
  includeSystem?: boolean;
  /** Batch size for item-fields and item-exists lookups. Default 25. */
  batchSize?: number;
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
 *   1. Page through `search` to enumerate items under `--root` (default
 *      `/sitecore/content`). Optionally include `/sitecore/system`.
 *   2. For each batch, fetch every field via `getItemFieldsBatch` (aliased
 *      GraphQL — one round trip per ~25 items).
 *   3. Run `extractInternalRefs` over field values to collect referenced
 *      itemIds (RichText `<link>` tags, bare GUIDs, pipe-delimited
 *      Multilist values).
 *   4. Resolve refs in bulk via `itemsExistBatch` — one aliased query per
 *      ~25 distinct refs. Cache the resolution across the audit so the
 *      same id doesn't get re-asked.
 *   5. Emit a report row for every (item, field, ref) where ref doesn't
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
  const limit = options.limit ?? 5000;
  const batchSize = options.batchSize ?? 25;
  const includeSystem = Boolean(options.includeSystem);

  logger.verbose(`Scanning under ${root} (limit ${limit}, batch ${batchSize}).`);

  // Resolve the root path to an itemId so we can filter the search index
  // by `_path: CONTAINS <rootItemId>`. We don't need fields here — just the
  // id. A single `item(where: {path}) { itemId }` query does it.
  const rootItem = await client.search({
    index: options.index,
    paging: { pageIndex: 0, pageSize: 1 },
    searchStatement: {
      criteria: {
        field: "_fullpath",
        value: root.toLowerCase(),
        criteriaType: "EXACT",
      },
    },
  });
  if (rootItem.totalCount === 0 || !rootItem.results[0]?.itemId) {
    logger.warn(`Root path '${root}' not found in search index — scanning entire master DB.`);
  }
  const rootItemId = rootItem.results[0]?.itemId;

  const scanned: Array<{
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
  }> = [];
  let count = 0;
  for await (const result of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(rootItemId && {
        searchStatement: buildPathFilterStatement(rootItemId),
      }),
    },
    100
  )) {
    if (!includeSystem && isSystemPath(result.path)) continue;
    scanned.push({
      itemId: normalizeItemId(result.itemId),
      path: result.path,
      templateName: result.templateName ?? null,
      language: result.language?.name ?? null,
    });
    count += 1;
    if (count >= limit) break;
  }
  logger.verbose(`Scanned ${scanned.length} items; fetching fields in batches.`);

  const fieldsByItemId = new Map<string, Awaited<ReturnType<typeof client.getItemFieldsBatch>>>();
  const batches: string[][] = [];
  for (let i = 0; i < scanned.length; i += batchSize) {
    batches.push(scanned.slice(i, i + batchSize).map((s) => s.itemId));
  }
  // Fan out the field reads with bounded concurrency. The transport's
  // backoff handles 429/503; we keep it conservative at 4 so a fresh
  // tenant doesn't get thundered.
  const fieldBatchResults = await mapWithConcurrency(
    batches,
    (ids) => client.getItemFieldsBatch(ids),
    4
  );
  for (const m of fieldBatchResults) {
    for (const [id, fields] of m) fieldsByItemId.set(id, fields as never);
  }

  // Collect every referenced itemId across all scanned items. De-dup to
  // avoid asking the API more than once for the same id.
  const allRefs = new Set<string>();
  type Pending = { itemId: string; path: string; fieldName: string; refItemId: string };
  const pendingRefs: Pending[] = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      // Skip empty values + Sitecore system fields (start with __ and
      // mostly hold metadata, not authored links).
      if (!field.value) continue;
      if (field.name.startsWith("__") && field.name !== "__Source Item") continue;
      const refs = extractInternalRefs(field.value);
      for (const ref of refs) {
        if (ref === item.itemId) continue; // self-ref is fine
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

  // Resolve refs in batches.
  const refExists = new Map<string, boolean>();
  const refIds = Array.from(allRefs);
  const refBatches: string[][] = [];
  for (let i = 0; i < refIds.length; i += batchSize) {
    refBatches.push(refIds.slice(i, i + batchSize));
  }
  const existResults = await mapWithConcurrency(
    refBatches,
    (ids) => client.itemsExistBatch(ids),
    4
  );
  for (const m of existResults) {
    for (const [id, exists] of m) refExists.set(id, exists);
  }

  // Build per-item broken-link reports.
  const byItem = new Map<string, BrokenLinkReport>();
  for (const p of pendingRefs) {
    if (refExists.get(p.refItemId) !== false) continue;
    const meta = scanned.find((s) => s.itemId === p.itemId);
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
    extra: { root, limit, scannedCount: scanned.length },
  });

  return reports;
};
