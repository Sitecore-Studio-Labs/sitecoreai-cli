import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "./shared";

export interface AuditLanguageDataOptions extends HygieneCommonOptions {
  /** Scope to descendants of this content path. Default `/sitecore/content`. */
  root?: string;
  /**
   * Languages to inspect for empty entries. Defaults to all languages
   * found in the search index under `--root`.
   */
  languages?: string[];
  /** Override the search index. */
  index?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Include system items. Off by default. */
  includeSystem?: boolean;
  /** Per-item check concurrency. Default 4. */
  concurrency?: number;
}

export interface LanguageDataReport {
  itemId: string;
  path: string;
  templateName?: string | null;
  /** Languages where the item exists as a database entry but has zero versions. */
  emptyLanguages: string[];
}

/**
 * Report items that have a per-language entry in the master DB but
 * **zero versions** in that language — the XM Cloud equivalent of the
 * dotnet `clean-invalid-language-data` diagnostic.
 *
 * **No remediation API on XM Cloud.** This command is read-only by
 * design. The Authoring GraphQL API exposes only two language
 * mutations:
 *   - `deleteLanguage(input: { database, name })` — removes the
 *     language from the entire tenant. Destructive; not per-item.
 *   - `deleteItemVersion` — removes a single version, but there's no
 *     version-zero entry to delete.
 *
 * There is no `deleteItemLanguage(itemId, language)` mutation on XM
 * Cloud Authoring. So the on-prem `clean-invalid-language-data` shape
 * (per-item, per-language cleanup) can't be ported.
 *
 * What this command does:
 *   1. Use search to enumerate items under `--root` and gather the set
 *      of languages observed across those items.
 *   2. For each item, ask the Authoring API for its versions per
 *      candidate language (`getItemVersions({ language })`). Versions
 *      list is empty → that's an empty-language-entry.
 *
 * Operators who want to "clean" can either: (a) re-author at least one
 * version in the affected language, or (b) `deleteLanguage` tenant-wide
 * if the language is no longer in use. Both are out-of-scope for this
 * command.
 */
export const runAuditLanguageData = async (
  options: AuditLanguageDataOptions
): Promise<LanguageDataReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  const root = options.root ?? "/sitecore/content";
  const limit = options.limit ?? 5000;
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;
  const includeSystem = Boolean(options.includeSystem);

  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;

  // Pass 1: enumerate items and collect language set per item.
  const itemLanguages = new Map<
    string,
    { path: string; templateName: string | null; languages: Set<string> }
  >();
  let scanned = 0;
  for await (const r of client.searchAll(
    {
      index: options.index,
      // Important: don't filter latestVersionOnly here — we want to see
      // language entries that have no versions at all.
      latestVersionOnly: false,
      ...(rootItemId && { searchStatement: buildPathFilterStatement(rootItemId) }),
    },
    100,
    knobs.pageParallelism
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    const id = normalizeItemId(r.itemId);
    if (!itemLanguages.has(id)) {
      itemLanguages.set(id, {
        path: r.path,
        templateName: r.templateName ?? null,
        languages: new Set(),
      });
      scanned += 1;
      if (scanned >= limit) break;
    }
    const lang = r.language?.name;
    if (lang) itemLanguages.get(id)!.languages.add(lang);
  }

  // If the user provided an explicit language set, intersect.
  const requested = options.languages?.length ? new Set(options.languages) : undefined;

  // Pass 2: probe each (item, language) pair for zero-version entries.
  type Pair = { itemId: string; path: string; templateName: string | null; language: string };
  const pairs: Pair[] = [];
  for (const [id, info] of itemLanguages) {
    for (const lang of info.languages) {
      if (requested && !requested.has(lang)) continue;
      pairs.push({ itemId: id, path: info.path, templateName: info.templateName, language: lang });
    }
  }
  logger.verbose(`Probing ${pairs.length} (item, language) pairs for empty entries.`);

  const empty = await mapWithConcurrency(
    pairs,
    async (p) => {
      const versions = await client.getItemVersions({
        itemId: p.itemId,
        language: p.language,
      });
      return versions.length === 0 ? p : null;
    },
    concurrency
  );

  const byItem = new Map<string, LanguageDataReport>();
  for (const p of empty) {
    if (!p) continue;
    const existing = byItem.get(p.itemId);
    if (existing) {
      existing.emptyLanguages.push(p.language);
    } else {
      byItem.set(p.itemId, {
        itemId: p.itemId,
        path: p.path,
        templateName: p.templateName,
        emptyLanguages: [p.language],
      });
    }
  }
  const reports = Array.from(byItem.values()).sort((a, b) => a.path.localeCompare(b.path));

  printReport({
    logger,
    command: "audit.language-data.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned} items, ${pairs.length} (item, language) pairs; ${reports.length} with empty language entries.`,
    formatLine: (r) => `${r.path} — empty: ${r.emptyLanguages.join(", ")}`,
    extra: { root, limit, scannedCount: scanned, pairsChecked: pairs.length },
  });

  return reports;
};
