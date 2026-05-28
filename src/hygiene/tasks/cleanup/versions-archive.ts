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

export interface CleanupVersionsArchiveOptions extends HygieneCommonOptions {
  /** Required. Number of most-recent versions to keep per (item, language). */
  keep: number;
  /** Required scope. */
  root: string;
  /** Restrict to one language. */
  language?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Override the search index. */
  index?: string;
  /** Concurrency. Default 4. */
  concurrency?: number;
  includeSystem?: boolean;
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * Permit operating against `/sitecore/system` / `/sitecore/templates`
   * subtrees. Off by default.
   */
  force?: boolean;
  /**
   * Name of the archive bucket. Default unset (Sitecore's default
   * archive). Useful for separating CLI-driven archive activity from
   * UI-driven activity.
   */
  archiveName?: string;
}

export interface VersionArchiveAction {
  itemId: string;
  path: string;
  language: string;
  versionsBefore: number;
  versionsAfter: number;
  archivedVersions: number[];
  errors: string[];
}

const PROTECTED_ROOTS = [
  "/sitecore/system",
  "/sitecore/templates/System",
  "/sitecore/layout/Layouts/System",
];

/**
 * Soft alternative to `cleanup versions prune`. Instead of deleting
 * older versions, move them to the Sitecore archive via `archiveVersion`.
 *
 * Same safety rails as `prune`:
 *   - `--root` required.
 *   - `--keep` must be >= 1.
 *   - Protected roots refused without `--force`.
 *   - `--allow-write` enforced outside `--what-if`.
 *
 * Difference from `prune`:
 *   - The mutation is `archiveVersion` instead of `deleteItemVersion`.
 *     Archived versions can be restored via `restoreArchivedVersion`
 *     (Sitecore admin UI) — reversible. Pruned versions are gone for
 *     good.
 *   - Returns `archiveVersionId` per archived version, surfaced in the
 *     report so operators can restore individual versions later.
 */
export const runCleanupVersionsArchive = async (
  options: CleanupVersionsArchiveOptions
): Promise<VersionArchiveAction[]> => {
  const logger = toLogger(options);

  if (!options.root) {
    throw createScaiError("--root is required for versions archive.", "INPUT_INVALID");
  }
  if (!Number.isFinite(options.keep) || options.keep < 1) {
    throw createScaiError("--keep must be an integer >= 1.", "INPUT_INVALID");
  }
  if (!options.force && PROTECTED_ROOTS.some((p) => options.root.startsWith(p))) {
    throw createScaiError(
      `Refusing to archive versions under protected path '${options.root}'.`,
      "INPUT_INVALID",
      { hint: "Pass --force to override the safety guard for system / template paths." }
    );
  }

  const { envName, root, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no versions will be archived.", "yellow");
  }

  const concurrency = options.concurrency ?? 4;
  const includeSystem = Boolean(options.includeSystem);
  const limit = options.limit ?? 5000;

  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: options.root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;
  if (!rootItemId) {
    throw createScaiError(
      `Root path '${options.root}' not found in search index.`,
      "INPUT_INVALID"
    );
  }

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
    keepFrom: number[];
    archiveFrom: number[];
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
      return {
        itemId: p.itemId,
        path: p.path,
        language: p.language,
        keepFrom: sorted.slice(0, options.keep).map((v) => v.version),
        archiveFrom: sorted.slice(options.keep).map((v) => v.version),
      };
    },
    concurrency
  );
  const plansWithWork = plans.filter((p): p is Plan => p !== null);

  const actions: VersionArchiveAction[] = await mapWithConcurrency(
    plansWithWork,
    async (plan): Promise<VersionArchiveAction> => {
      const action: VersionArchiveAction = {
        itemId: plan.itemId,
        path: plan.path,
        language: plan.language,
        versionsBefore: plan.keepFrom.length + plan.archiveFrom.length,
        versionsAfter: plan.keepFrom.length,
        archivedVersions: [],
        errors: [],
      };
      if (options.whatIf) {
        action.archivedVersions = plan.archiveFrom;
        return action;
      }
      for (const v of plan.archiveFrom) {
        try {
          await client.archiveVersion({
            itemId: dashifyItemId(plan.itemId),
            language: plan.language,
            version: v,
            archiveName: options.archiveName,
          });
          action.archivedVersions.push(v);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          action.errors.push(`v${v}: ${msg}`);
        }
      }
      action.versionsAfter = action.versionsBefore - action.archivedVersions.length;
      return action;
    },
    concurrency
  );

  actions.sort((a, b) => a.path.localeCompare(b.path));

  const totalArchived = actions.reduce((n, a) => n + a.archivedVersions.length, 0);
  const totalErrors = actions.reduce((n, a) => n + a.errors.length, 0);
  const summary = options.whatIf
    ? `Plan: would archive ${totalArchived} version${totalArchived === 1 ? "" : "s"} across ${actions.length} item-language pair${actions.length === 1 ? "" : "s"}.`
    : `Archived ${totalArchived} version${totalArchived === 1 ? "" : "s"} across ${actions.length} item-language pair${actions.length === 1 ? "" : "s"}${totalErrors > 0 ? ` (${totalErrors} error${totalErrors === 1 ? "" : "s"})` : ""}.`;

  printReport({
    logger,
    command: "cleanup.versions.archive",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.path} @${a.language}: keep ${a.versionsAfter}, archived ${a.archivedVersions.join(",") || "none"}${a.errors.length ? ` errors: ${a.errors.join(" / ")}` : ""}`,
    extra: {
      root: options.root,
      keep: options.keep,
      language: options.language ?? null,
      whatIf: Boolean(options.whatIf),
      scannedCount: scanned,
      plannedCount: plansWithWork.length,
      archivedCount: totalArchived,
      errorCount: totalErrors,
      archiveName: options.archiveName ?? null,
    },
    options,
  });

  return actions;
};
