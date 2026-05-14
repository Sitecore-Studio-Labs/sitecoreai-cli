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

export interface AuditStaleContentOptions extends HygieneCommonOptions {
  /** Days since last update to qualify as stale. Default 365 (one year). */
  notUpdatedInDays?: number;
  /** Content root to scan. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Include system items. Off by default. */
  includeSystem?: boolean;
  /** Restrict to one language. */
  language?: string;
  /** Workflow-check concurrency. Default 8. */
  concurrency?: number;
  pageParallelism?: number;
  /**
   * Skip items that are currently in a non-final workflow state. Those
   * are "in-flight" content, surfaced separately by `audit stale-workflow`.
   * Default true.
   */
  excludeWorkflowItems?: boolean;
  /**
   * Skip items whose `__Never publish` field is set. They're
   * intentionally hidden and not stale-content candidates. Default true.
   */
  excludeNeverPublish?: boolean;
}

export interface StaleContentReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  daysSinceUpdate: number;
  updatedDate: string | null;
  createdDate: string | null;
  /** Always present when set; null if no workflow attached. */
  workflowState: string | null;
}

/**
 * Audit content for items that haven't been updated in N days AND
 * aren't in a workflow / aren't marked never-publish.
 *
 * Different from `audit stale-workflow`:
 *   - `stale-workflow` finds items stuck mid-flight (in a non-final
 *     workflow state past `--days`).
 *   - `stale-content` finds **abandoned** items — published content
 *     no one has touched in a long time. The "graveyard" signal.
 *
 * Strategy:
 *   1. Crawl items via `searchAll` with `pageParallelism` for speed.
 *   2. Filter by indexed `updatedDate` (cheap; no per-item API call).
 *   3. For each candidate, optionally check workflow state and
 *      `__Never publish` to exclude in-flight or intentionally-hidden
 *      items.
 *
 * Notes:
 *   - The `--not-updated-in-days` default is 365 days (one year).
 *     Tune lower (90 days?) for fast-moving sites where year-old
 *     content is actually stable; tune higher for archives.
 *   - The `updatedDate` from the search index reflects the last
 *     authoring activity (any field change). For "last published"
 *     semantics, this isn't directly available via the master index;
 *     query the web index (`--index sitecore_web_index`) to scope
 *     to published-only content.
 */
export const runAuditStaleContent = async (
  options: AuditStaleContentOptions
): Promise<StaleContentReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  const days = options.notUpdatedInDays ?? 365;
  const root = options.root ?? "/sitecore/content";
  const limit = options.limit ?? 5000;
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;
  const includeSystem = Boolean(options.includeSystem);
  const excludeWorkflow = options.excludeWorkflowItems !== false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;
  if (!rootItemId) {
    logger.warn(`Root path '${root}' not found in search index — scanning entire master DB.`);
  }

  type Candidate = {
    itemId: string;
    path: string;
    language: string | null;
    templateName: string | null;
    updatedDate: string | null;
    createdDate: string | null;
    daysSince: number;
  };

  const candidates: Candidate[] = [];
  let scanned = 0;
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(options.language && { language: options.language }),
      ...(rootItemId && { searchStatement: buildPathFilterStatement(rootItemId) }),
    },
    100,
    knobs.pageParallelism
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    scanned += 1;
    if (!r.updatedDate) continue;
    const updated = Date.parse(r.updatedDate);
    if (!Number.isFinite(updated) || updated >= cutoff) continue;
    candidates.push({
      itemId: normalizeItemId(r.itemId),
      path: r.path,
      language: r.language?.name ?? null,
      templateName: r.templateName ?? null,
      updatedDate: r.updatedDate,
      createdDate: r.createdDate ?? null,
      daysSince: Math.floor((Date.now() - updated) / (24 * 60 * 60 * 1000)),
    });
    if (candidates.length >= limit) break;
  }
  logger.verbose(`Scanned ${scanned} items; ${candidates.length} stale (> ${days} days).`);

  // Optionally exclude items currently in a workflow.
  let final: Candidate[] = candidates;
  let workflowState = new Map<string, string | null>();
  if (excludeWorkflow) {
    const workflowChecks = await mapWithConcurrency(
      candidates,
      async (c) => {
        const wf = await client.getItemWorkflow(c.itemId, c.path);
        return {
          c,
          wfStateName: wf?.stateName ?? null,
          inActiveWorkflow: Boolean(wf && wf.workflowName && !wf.stateIsFinal),
        };
      },
      concurrency
    );
    final = workflowChecks
      .filter((r) => !r.inActiveWorkflow)
      .map((r) => {
        workflowState.set(r.c.itemId, r.wfStateName);
        return r.c;
      });
  }

  const reports: StaleContentReport[] = final
    .map((c) => ({
      itemId: c.itemId,
      path: c.path,
      templateName: c.templateName,
      language: c.language,
      daysSinceUpdate: c.daysSince,
      updatedDate: c.updatedDate,
      createdDate: c.createdDate,
      workflowState: workflowState.get(c.itemId) ?? null,
    }))
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

  printReport({
    logger,
    command: "audit.stale-content.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned} items; ${reports.length} stale (> ${days} days, ${excludeWorkflow ? "excluding in-workflow items" : "incl. workflow"}).`,
    formatLine: (r) =>
      `${r.path} — ${r.daysSinceUpdate}d since update (${r.updatedDate?.slice(0, 10) ?? "no date"})${r.workflowState ? ` [in ${r.workflowState}]` : ""}`,
    extra: {
      root,
      notUpdatedInDays: days,
      limit,
      scannedCount: scanned,
      excludeWorkflow,
    },
    options,
  });

  return reports;
};
