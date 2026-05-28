import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  dashifyItemId,
  ensureAllowWrite,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "../shared";

export interface CleanupVersionsPruneOptions extends HygieneCommonOptions {
  /**
   * Required. Number of most-recent versions to keep per (item, language).
   * Older versions are deleted. Must be >= 1.
   */
  keep: number;
  /**
   * Required scope. Prune is restricted to descendants of this content
   * path — there's no tenant-wide form. This is a guardrail: a stray
   * `--keep 1` against `/sitecore` would otherwise mass-delete platform
   * version history.
   */
  root: string;
  /**
   * Restrict pruning to one language. Defaults to all languages found
   * for each item.
   */
  language?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Override the search index. */
  index?: string;
  /** Concurrency for version reads + deletes. Default 4. */
  concurrency?: number;
  /** Include system items. Off by default. */
  includeSystem?: boolean;
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * Override the default safety guard that refuses to operate against
   * `/sitecore/system` or `/sitecore/templates` even when those are the
   * `--root`. Off by default. Set only when intentionally pruning
   * platform-area versions.
   */
  force?: boolean;
}

export interface VersionPruneAction {
  itemId: string;
  path: string;
  language: string;
  versionsBefore: number;
  versionsAfter: number;
  deletedVersions: number[];
  errors: string[];
}

const PROTECTED_ROOTS = [
  "/sitecore/system",
  "/sitecore/templates/System",
  "/sitecore/layout/Layouts/System",
];

/**
 * Prune per-item, per-language version history down to the N most recent
 * versions.
 *
 * Safety rails:
 *   - `--root` is required. The command never operates tenant-wide
 *     because a stray `--keep 1` would mass-delete platform versions.
 *   - `--keep` must be >= 1. Setting it to zero would orphan a language
 *     entry with no versions (the very pattern `audit language-data
 *     list` flags).
 *   - The `/sitecore/system`, `/sitecore/templates/System`, and
 *     `/sitecore/layout/Layouts/System` subtrees are protected; the
 *     prune refuses to operate on those paths unless `--force` is also
 *     set.
 *   - Without `--what-if`, the environment must have `allowWrite: true`
 *     (or `--allow-write` passed). Same contract as serialization push
 *     / recipe push.
 *
 * Behavior:
 *   1. Search for items under `--root` (one row per language). For each
 *      observed (item, language), fetch the version list via
 *      `getItemVersions`. If the list has more than `--keep` entries,
 *      schedule deletes for the oldest (`length - keep`) entries.
 *   2. Under `--what-if`, just emit the plan and return.
 *   3. Otherwise, execute `deleteItemVersion` sequentially per item
 *      (concurrent across items, bounded by `--concurrency`). Failures
 *      collect into the item's `errors` array but don't abort other
 *      items — the report shows partial success.
 */
export const runCleanupVersionsPrune = async (
  options: CleanupVersionsPruneOptions
): Promise<VersionPruneAction[]> => {
  const logger = toLogger(options);

  if (!options.root) {
    throw createScaiError("--root is required for versions prune.", "INPUT_INVALID", {
      hint: "Pass --root '/sitecore/content/<site>' to scope the prune.",
    });
  }
  if (!Number.isFinite(options.keep) || options.keep < 1) {
    throw createScaiError("--keep must be an integer >= 1.", "INPUT_INVALID");
  }
  if (!options.force && PROTECTED_ROOTS.some((p) => options.root.startsWith(p))) {
    throw createScaiError(
      `Refusing to prune versions under protected path '${options.root}'.`,
      "INPUT_INVALID",
      {
        hint: "Pass --force to override the safety guard for system / template paths.",
      }
    );
  }

  const { envName, root, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite, "cleanup-versions-prune");
  }

  const concurrency = options.concurrency ?? 4;
  const includeSystem = Boolean(options.includeSystem);
  const limit = options.limit ?? 5000;

  if (options.whatIf && !logger.isJson()) {
    logger.info("What-if mode active — no versions will be deleted.", "yellow");
  }

  // Resolve root → itemId for the search filter.
  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: {
        field: "_fullpath",
        value: options.root.toLowerCase(),
        criteriaType: "EXACT",
      },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;
  if (!rootItemId) {
    throw createScaiError(
      `Root path '${options.root}' not found in search index.`,
      "INPUT_INVALID",
      {
        hint: "Verify the path exists in the tenant before pruning.",
      }
    );
  }

  // Enumerate candidates: (item, language) pairs found via the index.
  const pairs = new Map<string, { itemId: string; path: string; language: string }>();
  let scanned = 0;
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: false,
      ...(options.language && { language: options.language }),
      searchStatement: buildPathFilterStatement(rootItemId),
    },
    100
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    const id = normalizeItemId(r.itemId);
    const lang = r.language?.name ?? options.language;
    if (!lang) continue;
    const key = `${id}|${lang}`;
    if (!pairs.has(key)) {
      pairs.set(key, { itemId: id, path: r.path, language: lang });
      scanned += 1;
      if (scanned >= limit) break;
    }
  }
  logger.verbose(`Scanned ${pairs.size} (item, language) candidates.`);

  type Plan = {
    itemId: string;
    path: string;
    language: string;
    keepFrom: Array<{ version: number }>;
    deleteFrom: Array<{ version: number }>;
  };

  const plans = await mapWithConcurrency(
    Array.from(pairs.values()),
    async (p): Promise<Plan | null> => {
      const versions = await client.getItemVersions({
        itemId: p.itemId,
        language: p.language,
      });
      if (versions.length <= options.keep) return null;
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      const keepFrom = sorted.slice(0, options.keep);
      const deleteFrom = sorted.slice(options.keep);
      return {
        itemId: p.itemId,
        path: p.path,
        language: p.language,
        keepFrom: keepFrom.map((v) => ({ version: v.version })),
        deleteFrom: deleteFrom.map((v) => ({ version: v.version })),
      };
    },
    concurrency
  );
  const plansWithWork = plans.filter((p): p is Plan => p !== null);

  const actions: VersionPruneAction[] = await mapWithConcurrency(
    plansWithWork,
    async (plan): Promise<VersionPruneAction> => {
      const action: VersionPruneAction = {
        itemId: plan.itemId,
        path: plan.path,
        language: plan.language,
        versionsBefore: plan.keepFrom.length + plan.deleteFrom.length,
        versionsAfter: plan.keepFrom.length,
        deletedVersions: [],
        errors: [],
      };
      if (options.whatIf) {
        action.deletedVersions = plan.deleteFrom.map((v) => v.version);
        return action;
      }
      // Delete sequentially per item — Authoring API serialises version
      // mutations per item anyway, and a parallel delete inside one item
      // can race on the version index.
      for (const v of plan.deleteFrom) {
        try {
          await client.deleteItemVersion({
            itemId: dashifyItemId(plan.itemId),
            language: plan.language,
            version: v.version,
          });
          action.deletedVersions.push(v.version);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          action.errors.push(`v${v.version}: ${msg}`);
        }
      }
      action.versionsAfter = action.versionsBefore - action.deletedVersions.length;
      return action;
    },
    concurrency
  );

  actions.sort((a, b) => a.path.localeCompare(b.path));

  const totalDeleted = actions.reduce((sum, a) => sum + a.deletedVersions.length, 0);
  const totalErrors = actions.reduce((sum, a) => sum + a.errors.length, 0);
  const summary = options.whatIf
    ? `Plan: would delete ${totalDeleted} version(s) across ${actions.length} item-language pair(s).`
    : `Deleted ${totalDeleted} version(s) across ${actions.length} item-language pair(s)${
        totalErrors > 0 ? ` (${totalErrors} error(s))` : ""
      }.`;

  printReport({
    logger,
    command: "cleanup.versions.prune",
    envName,
    results: actions,
    summary,
    formatLine: (a) => {
      const deleted = a.deletedVersions.length
        ? `${a.deletedVersions.length} version${a.deletedVersions.length === 1 ? "" : "s"} (${a.deletedVersions.join(",")})`
        : "none";
      const errors = a.errors.length ? ` errors: ${a.errors.join(" / ")}` : "";
      return `${a.path} @${a.language}: keep ${a.versionsAfter}, deleted ${deleted}.${errors}`;
    },
    extra: {
      root: options.root,
      keep: options.keep,
      language: options.language ?? null,
      whatIf: Boolean(options.whatIf),
      scannedCount: scanned,
      plannedCount: plansWithWork.length,
      deletedCount: totalDeleted,
      errorCount: totalErrors,
    },
    options,
  });

  return actions;
};
