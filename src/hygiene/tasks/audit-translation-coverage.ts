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

export interface AuditTranslationCoverageOptions extends HygieneCommonOptions {
  /** Content root. Default `/sitecore/content`. */
  root?: string;
  /** Reference (source) language. Default `en`. */
  referenceLanguage?: string;
  /** Target language(s) to compare against. Required. */
  targetLanguages?: string[];
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  pageParallelism?: number;
  exclude?: string[];
  since?: string;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
  /**
   * Threshold for "low coverage" — items where coverage % falls
   * below this are surfaced. Default 0 → report every untranslated
   * item. Set to e.g. 80 to flag languages below 80% coverage on
   * the summary line.
   */
  minCoveragePercent?: number;
}

export interface TranslationCoverageReport {
  language: string;
  totalReferenceItems: number;
  translatedItems: number;
  missingItems: number;
  coveragePercent: number;
  /** First 100 itemIds missing translation. */
  missingSamples: Array<{ itemId: string; path: string }>;
}

/**
 * Audit translation coverage between a reference language and one or
 * more target languages.
 *
 * Strategy:
 *   1. Use `searchAll` to enumerate every item under `--root` in
 *      `--reference-language` (default `en`). This is the "source
 *      truth" set of items.
 *   2. For each `--target-language`, enumerate the same root and
 *      collect itemIds present.
 *   3. Diff: items in reference set but missing from target set =
 *      untranslated. Compute coverage % per target.
 *
 * Different from `audit language-data list`:
 *   - `language-data` flags items with an empty language entry
 *     (zero versions in that language).
 *   - `translation-coverage` measures completeness — % of source-
 *     language items that have any version in the target.
 *
 * Notes:
 *   - The Authoring API's search index indexes per-version items, so
 *     an item without any target-language version simply doesn't
 *     appear in the target-language enumeration.
 *   - Item identity is by `itemId` — the same item with translations
 *     in en + fr appears once per language; we compare itemId sets.
 */
export const runAuditTranslationCoverage = async (
  options: AuditTranslationCoverageOptions
): Promise<TranslationCoverageReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const referenceLanguage = options.referenceLanguage ?? "en";
  const targets = options.targetLanguages ?? [];
  if (targets.length === 0) {
    logger.warn("No --target-languages provided; nothing to compare.");
  }
  const knobs = resolveHygieneKnobs(options);
  const limit = options.limit ?? 5000;
  const includeSystem = Boolean(options.includeSystem);
  const minCoverage = options.minCoveragePercent ?? 0;

  // Resolve root → itemId for the path filter.
  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;

  const enumerateLanguage = async (language: string): Promise<Map<string, { path: string }>> => {
    const map = new Map<string, { path: string }>();
    let count = 0;
    for await (const r of client.searchAll(
      {
        index: options.index,
        latestVersionOnly: true,
        language,
        ...(rootItemId && { searchStatement: buildPathFilterStatement(rootItemId) }),
      },
      100,
      knobs.pageParallelism
    )) {
      if (!includeSystem && isSystemPath(r.path)) continue;
      const id = normalizeItemId(r.itemId);
      if (!map.has(id)) {
        map.set(id, { path: r.path });
        count += 1;
        if (count >= limit) break;
      }
    }
    return map;
  };

  const reference = await enumerateLanguage(referenceLanguage);
  logger.verbose(`Reference language '${referenceLanguage}': ${reference.size} items.`);

  const reports: TranslationCoverageReport[] = [];
  for (const target of targets) {
    const translated = await enumerateLanguage(target);
    // `missingSamples` is a capped illustrative list. The true missing
    // count is `missingCount`, which keeps counting after the sample
    // list reaches its cap — otherwise every tenant with > 100 missing
    // items reported exactly 100 missing regardless of the real number.
    const missingSamples: TranslationCoverageReport["missingSamples"] = [];
    let missingCount = 0;
    for (const [id, info] of reference) {
      if (!translated.has(id)) {
        missingCount += 1;
        if (missingSamples.length < 100) missingSamples.push({ itemId: id, path: info.path });
      }
    }
    const translatedCount = reference.size - missingCount;
    const coverage = reference.size === 0 ? 100 : (translatedCount / reference.size) * 100;
    reports.push({
      language: target,
      totalReferenceItems: reference.size,
      translatedItems: translatedCount,
      missingItems: missingCount,
      coveragePercent: Math.round(coverage * 10) / 10,
      missingSamples,
    });
  }

  const flagged = reports.filter((r) => r.coveragePercent < minCoverage);
  const display = minCoverage > 0 ? flagged : reports;

  printReport({
    logger,
    command: "audit.translation-coverage.list",
    envName,
    results: display,
    summary: `Reference '${referenceLanguage}' = ${reference.size} items; ${reports.length} target language${reports.length === 1 ? "" : "s"} measured.`,
    formatLine: (r) =>
      `${r.language}: ${r.coveragePercent}% (${r.translatedItems}/${r.totalReferenceItems}; missing ${r.missingItems})`,
    extra: {
      root,
      referenceLanguage,
      targetLanguages: targets,
      minCoveragePercent: minCoverage,
    },
    options,
  });

  return display;
};
