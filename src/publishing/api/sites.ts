import type { EnvironmentConfiguration } from "@/config/types";
import { discoverSites } from "@/authoring";
import { createScaiError } from "@/shared/errors";
import { resolveItemPathsToIds } from "./path-resolver";

/**
 * Resolve a site name to its content-tree root item — the canonical
 * target for "publish this site" or "unpublish this site." Composes
 * scai's existing `discoverSites` (Authoring GraphQL tree walk for
 * `/sitecore/content/<tenant>/<site>`) with the path → itemId
 * resolver shipped in PR 2b.
 *
 * Two round trips total per call (one for the tenant/site walk, one
 * for the path → itemId batch query). Callers using `--site` on a
 * single command pay this once.
 *
 * Returns the resolved site, its content-tree path, and the item id.
 * Throws `INPUT_INVALID` with a helpful hint listing available sites
 * when the requested name doesn't exist in the tenant.
 */
export interface ResolvedSiteRoot {
  siteName: string;
  tenantName: string;
  path: string;
  itemId: string;
}

export const resolveSiteRoot = async (
  environment: EnvironmentConfiguration,
  siteName: string
): Promise<ResolvedSiteRoot> => {
  const sites = await discoverSites(environment);
  const match = sites.find((s) => s.name === siteName);
  if (!match) {
    const available = sites
      .map((s) => s.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 12);
    throw createScaiError(`Site '${siteName}' not found in the content tree.`, "INPUT_INVALID", {
      hint: `Available sites: ${available.join(", ")}${
        sites.length > available.length ? ` (and ${sites.length - available.length} more)` : ""
      }. Site discovery walks /sitecore/content/<tenant>/<site> — make sure the site lives under that convention.`,
    });
  }
  const { resolved } = await resolveItemPathsToIds(environment, [match.path]);
  return {
    siteName: match.name,
    tenantName: match.tenantName,
    path: match.path,
    itemId: resolved[0].itemId,
  };
};
