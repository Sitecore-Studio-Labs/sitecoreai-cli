import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  computeContentHash,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditDuplicatesOptions extends HygieneCommonOptions {
  /** Content root to scan. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Include `/sitecore/system` items. Off by default. */
  includeSystem?: boolean;
  /** Include `__`-prefixed system fields in the content hash. Off by default. */
  includeSystemFields?: boolean;
  /** Restrict the scan to one language. Default: all languages. */
  language?: string;
  /** Batch size for field reads. Default 25. */
  batchSize?: number;
  /**
   * Only flag groups with size >= `minGroupSize`. Default 2. Setting to
   * a higher value lets the operator focus on items copy-pasted many
   * times rather than incidental pairs.
   */
  minGroupSize?: number;
}

export interface DuplicatesGroup {
  contentHash: string;
  count: number;
  members: Array<{
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
    createdDate: string | null;
    updatedDate: string | null;
  }>;
}

/**
 * Audit content for items with byte-identical authored content,
 * grouped by content hash.
 *
 * Strategy:
 *   1. Enumerate items under `--root` via search (paged).
 *   2. Fetch fields per item in batches.
 *   3. Compute a content hash over authored fields only — excludes
 *      `__`-prefixed system fields by default since those carry
 *      per-item metadata (created/updated dates, lock owner, etc.)
 *      that would mask real duplicates.
 *   4. Group items by content hash; emit any group with >= `--min-group-size`
 *      members.
 *
 * Notes:
 *   - Items with all-empty fields are excluded from grouping (the hash
 *     input is empty → no signal). Use `audit empty-items list` to
 *     find those.
 *   - Hash collision risk at 16-hex chars is ~1 in 2^64 — well past
 *     tenant-scale item counts.
 *   - Cross-language duplicates: if `--language` is not set, items in
 *     different languages but with identical content (e.g. an English
 *     item duplicated as a French item with no translation yet) will
 *     group together. That's usually a signal of incomplete
 *     translation; pass `--language en` to scope.
 */
export const runAuditDuplicates = async (
  options: AuditDuplicatesOptions
): Promise<DuplicatesGroup[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const limit = options.limit ?? 5000;
  const batchSize = options.batchSize ?? 25;
  const includeSystem = Boolean(options.includeSystem);
  const minGroupSize = options.minGroupSize ?? 2;

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
  logger.verbose(`Scanned ${items.length} items; computing content hashes.`);

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

  // Hash + group.
  const groups = new Map<string, DuplicatesGroup>();
  for (const item of items) {
    const fields = fieldsMap.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const hash = await computeContentHash(fields, {
      includeSystem: options.includeSystemFields,
    });
    if (!hash) continue;
    const existing = groups.get(hash);
    if (existing) {
      existing.members.push(item);
      existing.count = existing.members.length;
    } else {
      groups.set(hash, { contentHash: hash, count: 1, members: [item] });
    }
  }

  const duplicates = Array.from(groups.values())
    .filter((g) => g.count >= minGroupSize)
    // Sort biggest groups first — usually the high-impact ones to fix.
    .sort((a, b) => b.count - a.count);

  printReport({
    logger,
    command: "audit.duplicates.list",
    envName,
    results: duplicates,
    summary: `Scanned ${items.length} items; ${duplicates.length} duplicate group${duplicates.length === 1 ? "" : "s"} (>= ${minGroupSize} members each).`,
    formatLine: (g) =>
      `[${g.contentHash}] ${g.count}× : ${g.members
        .slice(0, 3)
        .map((m) => m.path)
        .join(", ")}${g.count > 3 ? "…" : ""}`,
    extra: { root, limit, scannedCount: items.length, minGroupSize },
  });

  return duplicates;
};
