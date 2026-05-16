/**
 * `scai hygiene explain orphan-site <site>` — answer "what is left behind
 * for this site, and is any of it still referenced?"
 *
 * After a Sites-API site delete (or a subtree-removal mistake), folders
 * can survive under `/sitecore/templates/Project`, `/layout`, and the
 * media library with no active site pointing at them. `audit
 * site-residue` finds those orphan trees; but knowing an orphan is
 * *unreferenced* is what makes it safe to purge. This verb composes the
 * two:
 *
 *   - `audit site-residue` — orphan tenant/site trees (run silent).
 *   - `audit references`   — inbound field references to each orphan
 *                            (run silent, once per orphan tree).
 *
 * The report flags every orphan that still has inbound references —
 * those need their referrers resolved before a
 * `cleanup site-residue purge` is safe.
 */

import { createScaiError } from "@/shared/errors";
import { runAuditSiteResidue, type SiteResidueKind } from "../audit/site-residue";
import { runAuditReferences } from "../audit/references";
import { type HygieneCommonOptions, printReport, resolveTenant, toLogger } from "../shared";

export interface ExplainOrphanSiteOptions extends HygieneCommonOptions {
  /** Required. Site (or tenant) folder name to explain. */
  site?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on inbound refs counted per orphan tree. */
  limit?: number;
}

export interface OrphanSiteEntry {
  kind: SiteResidueKind;
  path: string;
  itemId: string;
  /** Descendant items in the orphan tree. */
  descendantCount: number;
  /** Inbound field references to the orphan tree's root, from live content. */
  inboundRefs: number;
}

export interface ExplainOrphanSiteReport {
  site: string;
  orphans: OrphanSiteEntry[];
}

const summarize = (site: string, orphans: OrphanSiteEntry[]): string => {
  if (orphans.length === 0) {
    return `No orphan residue found for site '${site}'.`;
  }
  const referenced = orphans.filter((o) => o.inboundRefs > 0).length;
  const trees = `${orphans.length} orphan tree${orphans.length === 1 ? "" : "s"}`;
  if (referenced === 0) {
    return `Site '${site}': ${trees}, none still referenced — safe to \`cleanup site-residue purge\`.`;
  }
  return (
    `Site '${site}': ${trees}; ${referenced} still referenced by live content — ` +
    `resolve those referrers before purging.`
  );
};

/**
 * Run `audit site-residue` for the named site, then `audit references`
 * against each orphan tree's root, and print one merged report.
 */
export const runExplainOrphanSite = async (
  options: ExplainOrphanSiteOptions
): Promise<ExplainOrphanSiteReport> => {
  if (!options.site) {
    throw createScaiError("explain orphan-site requires <site>.", "INPUT_INVALID");
  }
  const logger = toLogger(options);
  const { envName } = resolveTenant(options);
  const site = options.site;

  const residue = await runAuditSiteResidue({ ...options, silent: true });
  // Match by site folder (orphan-site) or tenant folder (orphan-tenant).
  const matched = residue.filter((r) => r.site === site || r.tenant === site);

  const orphans: OrphanSiteEntry[] = [];
  for (const r of matched) {
    const references = await runAuditReferences({ ...options, to: r.itemId, silent: true });
    const inboundRefs = references.reduce((n, ref) => n + ref.matches.length, 0);
    orphans.push({
      kind: r.kind,
      path: r.path,
      itemId: r.itemId,
      descendantCount: r.descendantCount,
      inboundRefs,
    });
  }
  // Referenced orphans first — those are the ones that need attention.
  orphans.sort((a, b) => b.inboundRefs - a.inboundRefs || a.path.localeCompare(b.path));

  const report: ExplainOrphanSiteReport = { site, orphans };

  printReport({
    logger,
    command: "explain.orphan-site",
    envName,
    results: orphans,
    summary: summarize(site, orphans),
    formatLine: (o) =>
      `[${o.kind}] ${o.path} — ${o.descendantCount} item(s), ` +
      `${o.inboundRefs} inbound ref(s)${o.inboundRefs > 0 ? " — still referenced" : ""}`,
    extra: { site, orphanCount: orphans.length },
    options,
  });

  return report;
};
