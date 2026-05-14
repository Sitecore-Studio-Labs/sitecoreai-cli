import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  ensureAllowWriteForCleanup,
  extractInternalRefs,
  normalizeItemId,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";
import {
  runAuditSiteResidue,
  type AuditSiteResidueOptions,
  type SiteResidueKind,
  type SiteResidueReport,
} from "./audit-site-residue";
import { discoverSites } from "@/recipe/api/site-discovery";
import type { HygieneApiClient } from "../api/client";

/**
 * Companion to `audit site-residue` — deletes the orphan tenant/site
 * subtrees the audit identifies.
 *
 * The upstream bug this works around: Sites-API DELETE doesn't cascade
 * to the SXA `templates/Project`, `layout/Renderings/Project`, and
 * `media library/Project` folders, so deleting a site leaves hundreds
 * of orphan items behind. This cleanup cascades through all three trees
 * (plus any operator-supplied `--root` paths) by calling
 * `Authoring.deleteItem` on each orphan root — Sitecore handles the
 * recursive delete server-side.
 *
 * Safety rails (matching the destructive-ops convention):
 *   - `--what-if` is the default. The mutation only runs when both
 *     `--what-if` is absent AND `--allow-write` is passed.
 *   - Inbound-ref pre-flight is ON by default. The cleanup walks every
 *     active-tenant content tree, extracts internal item refs, and
 *     matches them against the orphan-tree descendants. Any orphan with
 *     inbound refs from active content is **skipped** unless `--force`.
 *   - `--skip-ref-check` opts out of the pre-flight (faster, less
 *     safe — only use when you've just run `audit broken-links` and
 *     trust the result).
 */

const REFCHECK_LIMIT_PER_ORPHAN = 5000;

export interface CleanupSiteResidueOptions extends HygieneCommonOptions {
  root?: string[];
  contentRoot?: string;
  index?: string;
  concurrency?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * Delete orphans even when the pre-flight finds inbound refs from
   * active content. Default false — refs cause the orphan to be
   * skipped with `inboundRefs` populated in the report.
   */
  force?: boolean;
  /**
   * Skip the inbound-ref pre-flight entirely. Faster but loses the
   * safety net — pair with a separate `audit broken-links` run if you
   * use this.
   */
  skipRefCheck?: boolean;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface InboundRef {
  fromItemId: string;
  fromPath: string;
  fieldName: string;
  /** itemId inside the doomed tree that the active-content ref pointed at. */
  refItemId: string;
}

export interface SiteResidueCleanupAction {
  kind: SiteResidueKind;
  root: string;
  tenant: string;
  site: string | null;
  itemId: string;
  path: string;
  descendantCount: number;
  status: "deleted" | "what-if" | "skipped" | "failed";
  /** Populated when the pre-flight ran. Empty array = no inbound refs found. */
  inboundRefs?: InboundRef[];
  error?: string;
}

const collectDescendantIds = async (
  client: HygieneApiClient,
  itemId: string,
  index: string | undefined
): Promise<Set<string>> => {
  const ids = new Set<string>([normalizeItemId(itemId)]);
  let pageIndex = 0;
  const pageSize = 500;
  while (ids.size < REFCHECK_LIMIT_PER_ORPHAN) {
    const page = await client.search({
      index,
      latestVersionOnly: true,
      paging: { pageIndex, pageSize },
      searchStatement: {
        criteria: {
          field: "_path",
          value: normalizeItemId(itemId),
          criteriaType: "CONTAINS",
        },
      },
    });
    if (!page.results.length) break;
    for (const r of page.results) ids.add(normalizeItemId(r.itemId));
    if (page.results.length < pageSize) break;
    pageIndex += 1;
  }
  return ids;
};

const scanActiveContentForRefs = async (params: {
  client: HygieneApiClient;
  envName: string;
  options: CleanupSiteResidueOptions;
  contentRoot: string;
  logger: ReturnType<typeof toLogger>;
}): Promise<Array<{ itemId: string; path: string; field: string; refs: string[] }>> => {
  const { scanned, fieldsByItemId } = await scanItemsAndFields({
    client: params.client,
    envName: params.envName,
    root: params.contentRoot,
    logger: params.logger,
    options: params.options,
  });
  const rows: Array<{ itemId: string; path: string; field: string; refs: string[] }> = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field.value) continue;
      const refs = extractInternalRefs(field.value);
      if (refs.length === 0) continue;
      rows.push({
        itemId: item.itemId,
        path: item.path,
        field: field.name,
        refs,
      });
    }
  }
  return rows;
};

export const runCleanupSiteResidue = async (
  options: CleanupSiteResidueOptions
): Promise<SiteResidueCleanupAction[]> => {
  const logger = toLogger(options);
  const { envName, environment, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no orphan trees will be deleted.", "yellow");
  }

  const auditOptions = options as unknown as AuditSiteResidueOptions;
  const findings: SiteResidueReport[] = await runAuditSiteResidue({
    ...auditOptions,
    // Suppress the audit's own report write — the cleanup emits its
    // own consolidated envelope below.
    output: undefined,
    format: undefined,
    quiet: true,
  });

  if (findings.length === 0) {
    printReport({
      logger,
      command: "cleanup.site-residue.purge",
      envName,
      results: [],
      summary: "No orphan site-residue trees found.",
      formatLine: () => "",
      extra: { whatIf: Boolean(options.whatIf) },
      options,
    });
    return [];
  }

  const refsByOrphan = new Map<string, InboundRef[]>();
  if (!options.skipRefCheck) {
    logger.verbose(
      `Pre-flight: scanning active content for refs into ${findings.length} orphan tree${findings.length === 1 ? "" : "s"}.`
    );
    // Build a per-orphan descendant-itemId set so a single ref scan can
    // attribute hits back to the right orphan.
    const descendantsByOrphan = new Map<string, Set<string>>();
    await mapWithConcurrency(
      findings,
      async (finding) => {
        const ids = await collectDescendantIds(client, finding.itemId, options.index);
        descendantsByOrphan.set(finding.itemId, ids);
      },
      options.concurrency ?? 4
    );

    // Active sites give us the tenant roots that we treat as "live
    // content" — anything inside one of them with a ref into an orphan
    // tree is the problem we're trying to catch.
    const activeSites = await discoverSites(environment, {
      contentRoot: options.contentRoot,
    });
    const tenantRoots = Array.from(new Set(activeSites.map((s) => s.tenantPath)));
    if (tenantRoots.length === 0) {
      tenantRoots.push(options.contentRoot ?? "/sitecore/content");
    }

    for (const root of tenantRoots) {
      const rows = await scanActiveContentForRefs({
        client,
        envName,
        options,
        contentRoot: root,
        logger,
      });
      for (const row of rows) {
        for (const ref of row.refs) {
          const normalized = ref.toLowerCase();
          for (const [orphanId, descendants] of descendantsByOrphan) {
            if (!descendants.has(normalized)) continue;
            const list = refsByOrphan.get(orphanId) ?? [];
            list.push({
              fromItemId: row.itemId,
              fromPath: row.path,
              fieldName: row.field,
              refItemId: normalized,
            });
            refsByOrphan.set(orphanId, list);
          }
        }
      }
    }
  }

  const actions: SiteResidueCleanupAction[] = await mapWithConcurrency(
    findings,
    async (finding): Promise<SiteResidueCleanupAction> => {
      const inboundRefs = refsByOrphan.get(finding.itemId);
      const base: SiteResidueCleanupAction = {
        kind: finding.kind,
        root: finding.root,
        tenant: finding.tenant,
        site: finding.site,
        itemId: finding.itemId,
        path: finding.path,
        descendantCount: finding.descendantCount,
        status: "what-if",
        ...(options.skipRefCheck ? {} : { inboundRefs: inboundRefs ?? [] }),
      };
      // Inbound refs are the only thing that overrides --what-if /
      // --allow-write. If refs exist and the operator hasn't passed
      // --force, skip — leaving the orphan in place is safer than
      // breaking active content.
      if (inboundRefs && inboundRefs.length > 0 && !options.force) {
        return { ...base, status: "skipped" };
      }
      if (options.whatIf) {
        return base;
      }
      try {
        await client.deleteItem({ itemId: finding.itemId, permanently: true });
        return { ...base, status: "deleted" };
      } catch (error) {
        return {
          ...base,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    options.concurrency ?? 4
  );

  const deleted = actions.filter((a) => a.status === "deleted").length;
  const wouldDelete = actions.filter((a) => a.status === "what-if").length;
  const skipped = actions.filter((a) => a.status === "skipped").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const totalDescendants = actions
    .filter((a) => a.status === "deleted" || a.status === "what-if")
    .reduce((n, a) => n + a.descendantCount, 0);

  const summary = options.whatIf
    ? `Plan: would delete ${wouldDelete} orphan tree${wouldDelete === 1 ? "" : "s"} (~${totalDescendants} items)${
        skipped > 0 ? `, skip ${skipped} due to inbound refs` : ""
      }.`
    : `Deleted ${deleted} orphan tree${deleted === 1 ? "" : "s"} (~${totalDescendants} items)${
        skipped > 0 ? `, skipped ${skipped} due to inbound refs` : ""
      }${failed > 0 ? `, ${failed} failure${failed === 1 ? "" : "s"}` : ""}.`;

  printReport({
    logger,
    command: "cleanup.site-residue.purge",
    envName,
    results: actions,
    summary,
    formatLine: (a) => {
      const refTag =
        a.inboundRefs && a.inboundRefs.length > 0
          ? ` [${a.inboundRefs.length} inbound ref${a.inboundRefs.length === 1 ? "" : "s"}]`
          : "";
      const errorTag = a.error ? ` — ${a.error}` : "";
      const prefix =
        a.status === "deleted"
          ? "[deleted]"
          : a.status === "what-if"
            ? "[would delete]"
            : a.status === "skipped"
              ? "[skipped]"
              : "[failed]";
      return `${prefix} ${a.path} (${a.descendantCount} items)${refTag}${errorTag}`;
    },
    extra: {
      whatIf: Boolean(options.whatIf),
      skipRefCheck: Boolean(options.skipRefCheck),
      force: Boolean(options.force),
      deletedCount: deleted,
      wouldDeleteCount: wouldDelete,
      skippedCount: skipped,
      failedCount: failed,
    },
    options,
  });

  return actions;
};
