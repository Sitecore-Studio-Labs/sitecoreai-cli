import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditEmptyItemsOptions extends HygieneCommonOptions {
  /** Content root to scan. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Include system items. Off by default. */
  includeSystem?: boolean;
  /** Restrict to one language. Default: all languages found. */
  language?: string;
  /** Batch size for field reads. Default 25. */
  batchSize?: number;
  /**
   * If true, include items that only have a `__Standard values` reference
   * (i.e. fields inheriting from template defaults). Off by default —
   * those usually aren't actionable since they render the SV content.
   */
  includeStandardValuesOnly?: boolean;
}

export interface EmptyItemReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  createdDate: string | null;
  updatedDate: string | null;
}

/**
 * Audit content for items with no authored field values.
 *
 * Strategy:
 *   1. Enumerate items under `--root` via search.
 *   2. Fetch fields in batches.
 *   3. An item is "empty" when every non-`__` field has an empty or
 *      whitespace-only value. The default also excludes items that
 *      only inherit from template standard values (which render
 *      correctly even though they have no per-item values).
 *
 * Notes:
 *   - Folder items (template `Folder`, `Template Folder`, etc.)
 *     legitimately have no authored fields; they aren't surfaced as
 *     empty unless the operator explicitly opts in via
 *     `--include-folders` (not yet implemented; the search-index
 *     templates list isn't reliably populated to filter on).
 *   - "Item exists in DB but has zero versions in any language" is a
 *     different state — covered by `audit language-data list`.
 */
export const runAuditEmptyItems = async (
  options: AuditEmptyItemsOptions
): Promise<EmptyItemReport[]> => {
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
    createdDate: string | null;
    updatedDate: string | null;
  };
  const items: Item[] = [];
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(options.language && { language: options.language }),
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
      createdDate: r.createdDate ?? null,
      updatedDate: r.updatedDate ?? null,
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

  const empty: EmptyItemReport[] = [];
  for (const item of items) {
    const fields = fieldsMap.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    // Authored fields = non-system. Empty values include "", whitespace,
    // and the literal Sitecore field-not-present.
    const authored = fields.filter((f) => !f.name.startsWith("__"));
    if (authored.length === 0) continue; // No author-facing fields at all (folder-like).
    const hasValue = authored.some((f) => (f.value ?? "").trim().length > 0);
    if (hasValue) continue;
    empty.push({
      itemId: item.itemId,
      path: item.path,
      templateName: item.templateName,
      language: item.language,
      createdDate: item.createdDate,
      updatedDate: item.updatedDate,
    });
  }

  empty.sort((a, b) => a.path.localeCompare(b.path));

  printReport({
    logger,
    command: "audit.empty-items.list",
    envName,
    results: empty,
    summary: `Scanned ${items.length} items; ${empty.length} have no authored content.`,
    formatLine: (r) =>
      `${r.path}${r.templateName ? ` (${r.templateName})` : ""}${r.language ? ` @${r.language}` : ""}`,
    extra: { root, limit, scannedCount: items.length },
  });

  return empty;
};
