import { mapWithConcurrency } from "@/shared/cli-tasks";
import { discoverSites } from "@/recipe/api/site-discovery";
import {
  type HygieneCommonOptions,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "../shared";

/**
 * Audit for orphaned site residue across the SXA tenant/site folder
 * trees.
 *
 * The bug this catches: when a site is deleted via the Sites API,
 * the cascade only removes the SXA Site Grouping and immediate site
 * content — it does NOT clean up the parallel folders that SXA
 * provisions under:
 *
 *   /sitecore/templates/Project/<Tenant>/<Site>
 *   /sitecore/layout/Renderings/Project/<Tenant>/<Site>
 *   /sitecore/media library/Project/<Tenant>/<Site>
 *
 * Over time these leak. A deleted SXA site can leave hundreds of
 * orphan templates, renderings, and media items behind, none of which
 * any audit that stays within a single Sitecore tree can see.
 *
 * Strategy:
 *   1. Discover the authoritative active-site list via SXA Site
 *      Grouping items in `/sitecore/content` (the same source
 *      `scai provision deploy site list` uses).
 *   2. For each SXA root, list direct tenant folders and site folders.
 *   3. Emit a finding for every tenant / site folder whose name has
 *      no corresponding active-site entry.
 *
 * Default scope is the three SXA Project roots. Operators on non-SXA
 * tenants — or anyone investigating bespoke layout folders — can pass
 * `--root <path>` (repeatable) to extend the scan. The audit makes no
 * effort to second-guess SXA conventions: any direct child of a
 * scanned root is treated as a tenant folder, and any direct child of
 * that is treated as a site folder.
 */

const DEFAULT_RESIDUE_ROOTS = [
  "/sitecore/templates/Project",
  "/sitecore/layout/Renderings/Project",
  "/sitecore/media library/Project",
];

export interface AuditSiteResidueOptions extends HygieneCommonOptions {
  /**
   * Additional roots to scan on top of the three SXA defaults. Pass
   * repeatedly or comma-separate. Defaults to the standard SXA
   * Project folders under templates / layout / media library.
   */
  root?: string[];
  /** Override the content root walked when discovering active sites.
   *  Default `/sitecore/content` — same as `scai provision deploy site list`. */
  contentRoot?: string;
  index?: string;
  concurrency?: number;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export type SiteResidueKind = "orphan-tenant" | "orphan-site";

export interface SiteResidueReport {
  kind: SiteResidueKind;
  /** Root path under which the residue was found (e.g. `/sitecore/templates/Project`). */
  root: string;
  /** Tenant folder name as it appears in the residue tree. */
  tenant: string;
  /** Site folder name — null for `orphan-tenant`. */
  site: string | null;
  itemId: string;
  path: string;
  /** Descendant count from the search index (`_path CONTAINS itemId`).
   *  Useful for prioritising which residue tree to clean up first. */
  descendantCount: number;
}

const collectActiveSites = async (
  environment: Parameters<typeof discoverSites>[0],
  contentRoot: string | undefined
): Promise<{ tenants: Set<string>; sites: Set<string> }> => {
  const discovered = await discoverSites(environment, { contentRoot });
  const tenants = new Set<string>();
  const sites = new Set<string>();
  for (const site of discovered) {
    tenants.add(site.tenantName.toLowerCase());
    sites.add(`${site.tenantName.toLowerCase()}/${site.name.toLowerCase()}`);
  }
  return { tenants, sites };
};

export const runAuditSiteResidue = async (
  options: AuditSiteResidueOptions
): Promise<SiteResidueReport[]> => {
  const logger = toLogger(options);
  const { envName, environment, client } = resolveTenant(options);
  const extraRoots = options.root ?? [];
  const roots = [...DEFAULT_RESIDUE_ROOTS, ...extraRoots];
  const concurrency = options.concurrency ?? 8;

  logger.verbose(`Discovering active sites under ${options.contentRoot ?? "/sitecore/content"}.`);
  const { tenants: activeTenants, sites: activeSites } = await collectActiveSites(
    environment,
    options.contentRoot
  );
  logger.verbose(
    `Active sites: ${activeSites.size} across ${activeTenants.size} tenant${activeTenants.size === 1 ? "" : "s"}.`
  );

  const countDescendants = async (itemId: string): Promise<number> => {
    try {
      const page = await client.search({
        index: options.index,
        latestVersionOnly: true,
        paging: { pageSize: 1 },
        searchStatement: {
          criteria: {
            field: "_path",
            value: normalizeItemId(itemId),
            criteriaType: "CONTAINS",
          },
        },
      });
      // Subtract 1 so the count reflects the *descendants* — the item
      // itself satisfies `_path CONTAINS itemId` too.
      return Math.max(0, page.totalCount - 1);
    } catch (error) {
      logger.warn(
        `Descendant count failed for ${itemId}: ${error instanceof Error ? error.message : String(error)}. Reporting 0.`
      );
      return 0;
    }
  };

  const findings: SiteResidueReport[] = [];

  for (const root of roots) {
    let tenantFolders: Awaited<ReturnType<typeof client.getChildren>>;
    try {
      tenantFolders = await client.getChildren({ path: root });
    } catch (error) {
      logger.warn(
        `Skipping root '${root}': ${error instanceof Error ? error.message : String(error)}.`
      );
      continue;
    }
    if (tenantFolders.length === 0) {
      logger.verbose(`No tenant folders under ${root}.`);
      continue;
    }

    const tenantReports = await mapWithConcurrency(
      tenantFolders,
      async (tenant) => {
        const tenantKey = tenant.name.toLowerCase();
        if (!activeTenants.has(tenantKey)) {
          const descendants = await countDescendants(tenant.itemId);
          return [
            {
              kind: "orphan-tenant" as const,
              root,
              tenant: tenant.name,
              site: null,
              itemId: tenant.itemId,
              path: tenant.path,
              descendantCount: descendants,
            },
          ];
        }
        const siteFolders = await client.getChildren({ itemId: tenant.itemId });
        const siteReports: SiteResidueReport[] = [];
        for (const site of siteFolders) {
          const siteKey = `${tenantKey}/${site.name.toLowerCase()}`;
          if (activeSites.has(siteKey)) continue;
          const descendants = await countDescendants(site.itemId);
          siteReports.push({
            kind: "orphan-site",
            root,
            tenant: tenant.name,
            site: site.name,
            itemId: site.itemId,
            path: site.path,
            descendantCount: descendants,
          });
        }
        return siteReports;
      },
      concurrency
    );

    for (const batch of tenantReports) findings.push(...batch);
  }

  // Sort by descendant count desc (largest cleanup wins first) then by
  // path for stable diffs across runs.
  findings.sort((a, b) => {
    if (b.descendantCount !== a.descendantCount) {
      return b.descendantCount - a.descendantCount;
    }
    return a.path.localeCompare(b.path);
  });

  printReport({
    logger,
    command: "audit.site-residue.list",
    envName,
    results: findings,
    summary: `Scanned ${roots.length} root${roots.length === 1 ? "" : "s"}; ${findings.length} orphan ${findings.length === 1 ? "tree" : "trees"} (${findings.reduce((n, r) => n + r.descendantCount, 0)} descendant items).`,
    formatLine: (r) =>
      `${r.kind} ${r.path} (${r.descendantCount} item${r.descendantCount === 1 ? "" : "s"})`,
    extra: {
      activeTenantCount: activeTenants.size,
      activeSiteCount: activeSites.size,
      scannedRoots: roots,
    },
    options,
  });

  return findings;
};
