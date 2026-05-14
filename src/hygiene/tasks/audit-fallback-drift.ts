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

export interface AuditFallbackDriftOptions extends HygieneCommonOptions {
  root?: string;
  /** Reference (source) language. Default `en`. */
  referenceLanguage?: string;
  /** Target language(s) to compare. */
  targetLanguages?: string[];
  /** Threshold (days) — flag items where target lags reference by this many days. Default 30. */
  driftDays?: number;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  concurrency?: number;
  pageParallelism?: number;
  exclude?: string[];
  since?: string;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface FallbackDriftReport {
  itemId: string;
  path: string;
  targetLanguage: string;
  referenceUpdatedDate: string | null;
  targetUpdatedDate: string | null;
  driftDays: number;
}

/**
 * Audit items where the target-language version is older than the
 * reference-language version by more than `--drift-days` days.
 *
 * Catches the "English content was edited but the French translation
 * wasn't refreshed" pattern — different from `translation-coverage`
 * (presence/absence) and `language-data list` (zero-version
 * entries).
 *
 * Strategy:
 *   1. Enumerate items in `--reference-language`; index by itemId
 *      with their `updatedDate`.
 *   2. Per `--target-language`: enumerate items, compare each
 *      target's `updatedDate` against the reference's. If
 *      `reference - target > --drift-days`, flag it.
 *   3. Sort by drift descending — biggest gaps first.
 *
 * Notes:
 *   - Items without a target-language version are NOT reported here
 *     (use `translation-coverage` for that).
 *   - "Drift" only flows in one direction: reference newer than
 *     target. The reverse (target newer than reference) is unusual
 *     but legal — and we don't report it.
 */
export const runAuditFallbackDrift = async (
  options: AuditFallbackDriftOptions
): Promise<FallbackDriftReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const referenceLanguage = options.referenceLanguage ?? "en";
  const targets = options.targetLanguages ?? [];
  const driftDays = options.driftDays ?? 30;
  const driftMs = driftDays * 24 * 60 * 60 * 1000;
  const knobs = resolveHygieneKnobs(options);
  const limit = options.limit ?? 5000;
  const includeSystem = Boolean(options.includeSystem);

  if (targets.length === 0) {
    logger.warn("No --target-languages provided; nothing to compare.");
  }

  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;

  type Entry = { path: string; updatedDate: string | null };
  const enumerate = async (language: string): Promise<Map<string, Entry>> => {
    const map = new Map<string, Entry>();
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
        map.set(id, { path: r.path, updatedDate: r.updatedDate ?? null });
        count += 1;
        if (count >= limit) break;
      }
    }
    return map;
  };

  const reference = await enumerate(referenceLanguage);
  logger.verbose(`Reference '${referenceLanguage}': ${reference.size} items.`);

  // For each target language, page in parallel against the reference set.
  const reports: FallbackDriftReport[] = [];
  await mapWithConcurrency(
    targets,
    async (target) => {
      const targetMap = await enumerate(target);
      for (const [id, refEntry] of reference) {
        const targetEntry = targetMap.get(id);
        if (!targetEntry) continue; // missing translation — translation-coverage's job
        if (!refEntry.updatedDate || !targetEntry.updatedDate) continue;
        const refT = Date.parse(refEntry.updatedDate);
        const tgtT = Date.parse(targetEntry.updatedDate);
        if (!Number.isFinite(refT) || !Number.isFinite(tgtT)) continue;
        const drift = refT - tgtT;
        if (drift <= driftMs) continue;
        reports.push({
          itemId: id,
          path: refEntry.path,
          targetLanguage: target,
          referenceUpdatedDate: refEntry.updatedDate,
          targetUpdatedDate: targetEntry.updatedDate,
          driftDays: Math.floor(drift / (24 * 60 * 60 * 1000)),
        });
      }
    },
    Math.max(1, Math.min(targets.length, knobs.pageParallelism))
  );

  reports.sort((a, b) => b.driftDays - a.driftDays);

  printReport({
    logger,
    command: "audit.fallback-drift.list",
    envName,
    results: reports,
    summary: `Reference '${referenceLanguage}' = ${reference.size} items; ${reports.length} drifted in target languages by > ${driftDays} days.`,
    formatLine: (r) =>
      `${r.path} [${r.targetLanguage}] — ${r.driftDays}d drift (ref ${r.referenceUpdatedDate?.slice(0, 10)}, target ${r.targetUpdatedDate?.slice(0, 10)})`,
    extra: { root, referenceLanguage, targetLanguages: targets, driftDays },
    options,
  });

  return reports;
};
