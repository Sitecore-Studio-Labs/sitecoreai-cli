import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  ensureAllowWriteForCleanup,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

export interface CleanupArchivePurgeOptions extends HygieneCommonOptions {
  /**
   * Only purge archived items older than N days. Default 30. Setting to
   * 0 purges everything in the archive (use with care).
   */
  olderThanDays?: number;
  /** Cap on the number of items purged. Default 1000. */
  limit?: number;
  /** Limit to a specific archive name. */
  archiveName?: string;
  /** Concurrency for delete calls. Default 4. */
  concurrency?: number;
  /** Page size for archive listing. Default 100. */
  pageSize?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
}

export interface ArchivePurgeAction {
  archivalId: string;
  itemId: string;
  name: string;
  originalLocation: string;
  archivedDate: string | null;
  daysSinceArchived: number | null;
  status: "purged" | "skipped" | "what-if" | "failed";
  error?: string;
}

/**
 * Purge items from the Sitecore archive (recycle bin) that have been
 * archived longer than `--older-than-days N`.
 *
 * Strategy:
 *   1. Page through `archivedItems`, computing days-since-archived per
 *      record.
 *   2. Skip records younger than the threshold.
 *   3. For each eligible record, call `deleteArchivedItem(archivalId)`.
 *      Failures don't abort; they're collected per-record so the report
 *      shows partial success.
 *
 * Safety rails:
 *   - `ensureAllowWriteForCleanup` enforces `--allow-write` / env
 *     `allowWrite` outside `--what-if` mode.
 *   - `--older-than-days 0` is allowed but logged as a warning — it
 *     purges everything in the archive.
 *   - There is no `--force` here because archive items are already a
 *     "soft delete" by Sitecore's standards. Operators who got here
 *     have already accepted the data loss.
 */
export const runCleanupArchivePurge = async (
  options: CleanupArchivePurgeOptions
): Promise<ArchivePurgeAction[]> => {
  const logger = toLogger(options);
  const { envName, root, client } = resolveTenant(options);

  const olderThanDays = options.olderThanDays ?? 30;
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw createScaiError("--older-than-days must be a non-negative integer.", "INPUT_INVALID");
  }
  if (olderThanDays === 0 && !logger.isJson()) {
    logger.warn("--older-than-days=0 will purge the entire archive.");
  }
  const limit = options.limit ?? 1000;
  const concurrency = options.concurrency ?? 4;
  const pageSize = options.pageSize ?? 100;

  if (!options.whatIf) {
    ensureAllowWriteForCleanup(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no archived items will be deleted.", "yellow");
  }

  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  type Candidate = {
    archivalId: string;
    itemId: string;
    name: string;
    originalLocation: string;
    archivedDate: string | null;
    daysSince: number | null;
  };
  const candidates: Candidate[] = [];
  let pageIndex = 0;
  while (candidates.length < limit) {
    const page = await client.listArchivedItems({
      archiveName: options.archiveName,
      pageIndex,
      pageSize,
    });
    if (page.length === 0) break;
    for (const item of page) {
      if (candidates.length >= limit) break;
      const ts = item.archivedDate ? Date.parse(item.archivedDate) : NaN;
      const eligible = !Number.isFinite(ts) || ts <= cutoff;
      if (!eligible) continue;
      const daysSince = Number.isFinite(ts)
        ? Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000))
        : null;
      candidates.push({
        archivalId: item.archivalId,
        itemId: item.itemId,
        name: item.name,
        originalLocation: item.originalLocation,
        archivedDate: item.archivedDate,
        daysSince,
      });
    }
    if (page.length < pageSize) break;
    pageIndex += 1;
  }
  logger.verbose(`Found ${candidates.length} eligible archived items.`);

  const actions: ArchivePurgeAction[] = await mapWithConcurrency(
    candidates,
    async (c): Promise<ArchivePurgeAction> => {
      const base = {
        archivalId: c.archivalId,
        itemId: c.itemId,
        name: c.name,
        originalLocation: c.originalLocation,
        archivedDate: c.archivedDate,
        daysSinceArchived: c.daysSince,
      };
      if (options.whatIf) {
        return { ...base, status: "what-if" };
      }
      try {
        await client.deleteArchivedItem(c.archivalId, options.archiveName);
        return { ...base, status: "purged" };
      } catch (error) {
        return {
          ...base,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    concurrency
  );

  const purged = actions.filter((a) => a.status === "purged").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const summary = options.whatIf
    ? `Plan: would purge ${actions.length} archived item${actions.length === 1 ? "" : "s"} older than ${olderThanDays} days.`
    : `Purged ${purged} archived item${purged === 1 ? "" : "s"} older than ${olderThanDays} days${
        failed > 0 ? ` (${failed} failed)` : ""
      }.`;

  printReport({
    logger,
    command: "cleanup.archive.purge",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "what-if" ? "[would purge] " : a.status === "failed" ? "[failed] " : ""}${a.name} from ${a.originalLocation}${a.daysSinceArchived !== null ? ` (${a.daysSinceArchived}d)` : ""}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      olderThanDays,
      archiveName: options.archiveName ?? null,
      whatIf: Boolean(options.whatIf),
      purgedCount: purged,
      failedCount: failed,
    },
    options,
  });

  return actions;
};
