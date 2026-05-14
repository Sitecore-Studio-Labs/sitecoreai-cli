import {
  type HygieneCommonOptions,
  normalizeItemId,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface AuditSlugConflictsOptions extends HygieneCommonOptions {
  /** Content root. Default `/sitecore/content`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  language?: string;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  exclude?: string[];
  since?: string;
  owner?: string;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
  /**
   * Use case-insensitive matching for the slug comparison. Default
   * true. Sitecore item names are case-sensitive on disk but URL
   * resolution is case-insensitive on most renderers.
   */
  caseInsensitive?: boolean;
}

export interface SlugConflictGroup {
  parentPath: string;
  slug: string;
  count: number;
  members: Array<{
    itemId: string;
    path: string;
    name: string;
    templateName: string | null;
    language: string | null;
  }>;
}

/**
 * Audit content for siblings sharing the same item name (slug).
 *
 * URL resolution under Sitecore typically uses the item name as the
 * URL segment. Two siblings with identical names (case-insensitively)
 * produce ambiguous URLs and unpredictable routing.
 *
 * Strategy:
 *   1. Enumerate items via `scanItemsAndFields` (no fields needed →
 *      `skipFields: true`).
 *   2. Group by `(parentPath, lowercased-name)`.
 *   3. Emit groups with >= 2 members.
 *
 * Notes:
 *   - Cross-language siblings (en + fr versions of the same item)
 *     share an itemId and don't show as conflicts — they're the same
 *     item with different language entries.
 *   - True conflicts are two distinct itemIds under the same parent
 *     with the same name. Rare but high-impact when present.
 */
export const runAuditSlugConflicts = async (
  options: AuditSlugConflictsOptions
): Promise<SlugConflictGroup[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const caseInsensitive = options.caseInsensitive !== false;

  const { scanned, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
    skipFields: true,
  });

  type Key = string; // `${parentPath}|${normalizedName}`
  const groups = new Map<Key, SlugConflictGroup>();
  const seenItemsInGroup = new Map<Key, Set<string>>();
  for (const item of scanned) {
    const lastSlash = item.path.lastIndexOf("/");
    if (lastSlash <= 0) continue;
    const parentPath = item.path.slice(0, lastSlash);
    const name = item.name;
    const slug = caseInsensitive ? name.toLowerCase() : name;
    const key = `${parentPath}|${slug}`;
    const normalizedItemId = normalizeItemId(item.itemId);
    let seen = seenItemsInGroup.get(key);
    if (!seen) {
      seen = new Set();
      seenItemsInGroup.set(key, seen);
    }
    if (seen.has(normalizedItemId)) continue; // dedupe per-itemId (multi-language same item)
    seen.add(normalizedItemId);
    let group = groups.get(key);
    if (!group) {
      group = { parentPath, slug, count: 0, members: [] };
      groups.set(key, group);
    }
    group.members.push({
      itemId: normalizedItemId,
      path: item.path,
      name: item.name,
      templateName: item.templateName,
      language: item.language,
    });
    group.count = group.members.length;
  }

  const conflicts = Array.from(groups.values())
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || a.parentPath.localeCompare(b.parentPath));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.slug-conflicts.list",
    envName,
    results: conflicts,
    summary: `Scanned ${scanned.length} items; ${conflicts.length} parent path${conflicts.length === 1 ? "" : "s"} have sibling-name conflicts.`,
    formatLine: (g) => `${g.parentPath}/${g.slug}* (${g.count}×)`,
    extra: { root, scannedCount: scanned.length, caseInsensitive },
    options,
  });

  return conflicts;
};
