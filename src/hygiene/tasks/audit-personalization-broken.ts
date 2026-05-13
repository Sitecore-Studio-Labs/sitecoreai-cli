import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  extractPersonalizationRefs,
  isRenderingField,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditPersonalizationBrokenOptions extends HygieneCommonOptions {
  /** Content root to scan. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Include system items. Off by default. */
  includeSystem?: boolean;
  /** Batch size. Default 25. */
  batchSize?: number;
}

export interface PersonalizationBrokenReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  /** Each broken personalization ref the item carries. */
  brokenRefs: Array<{ fieldName: string; refItemId: string }>;
}

/**
 * Audit page items for personalization rules referencing missing items.
 *
 * Strategy:
 *   1. Enumerate items under `--root` via search.
 *   2. Fetch fields; parse `__Renderings` / `__Final Renderings` XML.
 *   3. Extract personalization refs from `<action datasource=...>` and
 *      `<rules s:set=...>` attributes.
 *   4. Batch-resolve those itemIds; report unresolved ones grouped per
 *      page item.
 *
 * Notes:
 *   - Variant items live under
 *     `<page>/Presentation/Personalization/<variant>` typically, or
 *     reference items in the data tree. Either way, resolution is by
 *     itemId — the path doesn't matter.
 *   - This audit complements `audit datasource-missing list`: the
 *     latter checks the static datasource on `<r>` elements; this one
 *     checks the personalization conditional refs inside `<rules>`
 *     blocks. An item can have both.
 *   - "Rule sets" (`s:set` attributes) reference shared rule
 *     definitions in `/sitecore/system/Settings/Rules/...`. Broken
 *     refs there are rarer but high-impact (personalization fails
 *     silently or behaves unexpectedly).
 */
export const runAuditPersonalizationBroken = async (
  options: AuditPersonalizationBrokenOptions
): Promise<PersonalizationBrokenReport[]> => {
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
      if (!isRenderingField(field.name) || !field.value) continue;
      const refs = extractPersonalizationRefs(field.value);
      for (const raw of refs) {
        const norm = normalizeItemId(raw);
        if (norm.length !== 32) continue;
        if (norm === item.itemId) continue;
        pending.push({
          itemId: item.itemId,
          path: item.path,
          templateName: item.templateName,
          language: item.language,
          fieldName: field.name,
          refItemId: norm,
        });
        refsToResolve.add(norm);
      }
    }
  }
  logger.verbose(
    `Found ${pending.length} personalization refs (${refsToResolve.size} distinct); resolving.`
  );

  const refExists = new Map<string, boolean>();
  const refList = Array.from(refsToResolve);
  for (let i = 0; i < refList.length; i += batchSize) {
    const batch = refList.slice(i, i + batchSize);
    const result = await client.itemsExistBatch(batch);
    for (const [id, exists] of result) refExists.set(id, exists);
  }

  const byItem = new Map<string, PersonalizationBrokenReport>();
  for (const p of pending) {
    if (refExists.get(p.refItemId) !== false) continue;
    const existing = byItem.get(p.itemId);
    const entry = { fieldName: p.fieldName, refItemId: p.refItemId };
    if (existing) {
      // Avoid duplicate entries (same ref via multiple personalization actions).
      if (!existing.brokenRefs.some((b) => b.refItemId === entry.refItemId)) {
        existing.brokenRefs.push(entry);
      }
    } else {
      byItem.set(p.itemId, {
        itemId: p.itemId,
        path: p.path,
        templateName: p.templateName,
        language: p.language,
        brokenRefs: [entry],
      });
    }
  }
  const reports = Array.from(byItem.values()).sort((a, b) => a.path.localeCompare(b.path));

  printReport({
    logger,
    command: "audit.personalization-broken.list",
    envName,
    results: reports,
    summary: `Scanned ${items.length} items; ${reports.length} have broken personalization refs.`,
    formatLine: (r) =>
      `${r.path} — ${r.brokenRefs.length} broken: ${r.brokenRefs
        .slice(0, 3)
        .map((b) => b.refItemId.slice(0, 8))
        .join(", ")}${r.brokenRefs.length > 3 ? "…" : ""}`,
    extra: { root, limit, scannedCount: items.length },
  });

  return reports;
};
