import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  isPageDesignField,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditPageDesignOrphansOptions extends HygieneCommonOptions {
  /** Content root to scan. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Include system items. Off by default. */
  includeSystem?: boolean;
  /** Batch size for field reads + ref resolution. Default 25. */
  batchSize?: number;
}

export interface PageDesignOrphanReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  fieldName: string;
  /** The page-design itemId that the page references but isn't resolvable. */
  pageDesignRef: string;
}

/**
 * Audit page items for references to page designs (Sitecore XM Cloud
 * SXA) that don't exist.
 *
 * Strategy:
 *   1. Enumerate items under `--root` via search.
 *   2. Fetch fields in batches; for each, look at `__Final Page Design`
 *      (primary) and `__Page Design` (fallback). Non-empty value =
 *      explicit page-design ref. Empty values are skipped (the page
 *      inherits from an ancestor; that's legal).
 *   3. Resolve each unique referenced itemId via `itemsExistBatch`.
 *   4. Report items where the referenced page-design doesn't resolve.
 *
 * Notes:
 *   - On XM Cloud SXA, the `__Final Page Design` field stores a single
 *     itemId GUID pointing at a page-design item under
 *     `/sitecore/content/<site>/Presentation/Page Designs`. Deleting
 *     a page design without first clearing the references from pages
 *     produces orphaned references — this audit surfaces them.
 *   - Multiple pages may reference the same broken page design;
 *     each is reported individually so the operator can see the
 *     full blast radius.
 */
export const runAuditPageDesignOrphans = async (
  options: AuditPageDesignOrphansOptions
): Promise<PageDesignOrphanReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const limit = options.limit ?? 5000;
  const batchSize = options.batchSize ?? 25;
  const includeSystem = Boolean(options.includeSystem);

  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;

  type Item = {
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
  };
  const items: Item[] = [];
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(rootItemId && { searchStatement: buildPathFilterStatement(rootItemId) }),
    },
    100
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    items.push({
      itemId: normalizeItemId(r.itemId),
      path: r.path,
      templateName: r.templateName ?? null,
      language: r.language?.name ?? null,
    });
    if (items.length >= limit) break;
  }
  logger.verbose(`Scanned ${items.length} items.`);

  const fieldsMap = new Map<string, Awaited<ReturnType<typeof client.getItemFieldsBatch>>>();
  const batches: string[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize).map((it) => it.itemId));
  }
  const fieldBatches = await mapWithConcurrency(
    batches,
    (ids) => client.getItemFieldsBatch(ids),
    4
  );
  for (const m of fieldBatches) {
    for (const [id, fields] of m) fieldsMap.set(id, fields as never);
  }

  type Pending = {
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
    fieldName: string;
    refItemId: string;
  };
  const pending: Pending[] = [];
  const refsToResolve = new Set<string>();
  for (const item of items) {
    const fields = fieldsMap.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!isPageDesignField(field.name)) continue;
      if (!field.value || !field.value.trim()) continue;
      const refItemId = normalizeItemId(field.value.trim());
      if (refItemId.length !== 32) continue;
      pending.push({
        itemId: item.itemId,
        path: item.path,
        templateName: item.templateName,
        language: item.language,
        fieldName: field.name,
        refItemId,
      });
      refsToResolve.add(refItemId);
    }
  }

  const refExists = new Map<string, boolean>();
  const refList = Array.from(refsToResolve);
  for (let i = 0; i < refList.length; i += batchSize) {
    const batch = refList.slice(i, i + batchSize);
    const result = await client.itemsExistBatch(batch);
    for (const [id, exists] of result) refExists.set(id, exists);
  }

  const orphans: PageDesignOrphanReport[] = pending
    .filter((p) => refExists.get(p.refItemId) === false)
    .map((p) => ({
      itemId: p.itemId,
      path: p.path,
      templateName: p.templateName,
      language: p.language,
      fieldName: p.fieldName,
      pageDesignRef: p.refItemId,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  printReport({
    logger,
    command: "audit.page-design-orphans.list",
    envName,
    results: orphans,
    summary: `Scanned ${items.length} items; ${orphans.length} reference missing page designs.`,
    formatLine: (r) => `${r.path} — ${r.fieldName}→${r.pageDesignRef.slice(0, 8)}`,
    extra: { root, limit, scannedCount: items.length },
  });

  return orphans;
};
