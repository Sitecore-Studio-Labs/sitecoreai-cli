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
} from "../shared";

export interface AuditStaleWorkflowOptions extends HygieneCommonOptions {
  /** Days since last update to qualify as stale. Default 30. */
  days?: number;
  /** Scope to descendants of this content path. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on the number of items inspected. Default 5000. */
  limit?: number;
  /** Include system items in the scan. Off by default. */
  includeSystem?: boolean;
  /** Workflow concurrency. Default 4. */
  concurrency?: number;
}

export interface StaleWorkflowReport {
  itemId: string;
  path: string;
  language: string | null;
  templateName?: string | null;
  workflowName: string | null;
  stateName: string | null;
  stateIsFinal: boolean;
  daysSinceUpdate: number;
  updatedDate: string | null;
}

/**
 * Audit items currently in a non-final workflow state whose last update
 * is older than `--days N`.
 *
 * Strategy:
 *   1. Search-index pass over `--root` (default `/sitecore/content`)
 *      collects every item plus its indexed `updatedDate`. We filter
 *      *here* by `updatedDate < (now - N days)` — efficient because the
 *      index has the date directly. The "is in workflow" check needs
 *      the Authoring API (search index does not expose `__Workflow
 *      state` reliably across XM Cloud tenants).
 *   2. For each stale candidate, call `getItemWorkflow(itemId)`. Skip
 *      items that aren't on a workflow or are already in a final state.
 *
 * Notes:
 *   - "In a workflow" means `Item.workflow.workflow` resolves and the
 *     `workflowState.final` is false. Items past the final state (e.g.
 *     "Approved") are considered not stale.
 *   - The N-days threshold uses the search index's `updatedDate`. If
 *     that field isn't populated for some items (rare; mostly platform
 *     items), they're skipped — and platform items are skipped by
 *     default anyway.
 */
export const runAuditStaleWorkflow = async (
  options: AuditStaleWorkflowOptions
): Promise<StaleWorkflowReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  const days = options.days ?? 30;
  const root = options.root ?? "/sitecore/content";
  const limit = options.limit ?? 5000;
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;
  const includeSystem = Boolean(options.includeSystem);
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
    daysSince: number;
  };

  const candidates: Candidate[] = [];
  let scanned = 0;
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
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
      daysSince: Math.floor((Date.now() - updated) / (24 * 60 * 60 * 1000)),
    });
    if (candidates.length >= limit) break;
  }
  logger.verbose(`Scanned ${scanned} items; ${candidates.length} stale (> ${days} days).`);

  const workflowChecks = await mapWithConcurrency(
    candidates,
    async (c) => {
      const wf = await client.getItemWorkflow(c.itemId, c.path);
      if (!wf || !wf.workflowName || wf.stateIsFinal) return null;
      return { candidate: c, wf };
    },
    concurrency
  );

  const stale: StaleWorkflowReport[] = workflowChecks
    .filter(
      (x): x is { candidate: Candidate; wf: NonNullable<(typeof workflowChecks)[number]>["wf"] } =>
        x !== null
    )
    .map(({ candidate, wf }) => ({
      itemId: candidate.itemId,
      path: candidate.path,
      language: candidate.language,
      templateName: candidate.templateName,
      workflowName: wf.workflowName,
      stateName: wf.stateName,
      stateIsFinal: wf.stateIsFinal,
      daysSinceUpdate: candidate.daysSince,
      updatedDate: candidate.updatedDate,
    }));

  stale.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

  printReport({
    logger,
    command: "audit.stale-workflow.list",
    envName,
    results: stale,
    summary: `Scanned ${scanned} items; ${stale.length} stuck in workflow > ${days} days.`,
    formatLine: (r) =>
      `${r.path} — ${r.workflowName} @ "${r.stateName ?? "?"}" (${r.daysSinceUpdate}d)`,
    extra: { root, days, limit, scannedCount: scanned },
    options,
  });

  return stale;
};
