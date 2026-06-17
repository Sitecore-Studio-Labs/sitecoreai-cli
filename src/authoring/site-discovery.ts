/**
 * Discover SXA sites in a Sitecore CM environment via the Authoring
 * GraphQL API.
 *
 * Cross-domain home of site discovery (deploy / hygiene / publishing all
 * use it); `recipe/api/site-discovery.ts` is now a published-API
 * forwarder that re-exports from here.
 *
 * The convention this walks: each CM environment has a single tenant
 * at `/sitecore/content/<Tenant>` with one or more sites under it at
 * `/sitecore/content/<Tenant>/<Site>`. Tenants and sites are identified
 * by template name match rather than hard-coded template GUIDs so
 * the discovery is resilient across SXA / XM Cloud variants:
 *
 *   - Tenant: `Tenant`, `Tenant Folder`, `Headless Tenant`,
 *     `Headless Tenant Folder`
 *   - Site:   `Site`, `Headless Site`
 *
 * Two round trips minimum:
 *   1. children of `/sitecore/content`        → candidate tenants
 *   2. children of each tenant                → candidate sites
 *
 * Sites typically expose hostnames via a `Settings/Site Grouping/<grouping>`
 * sub-item. Walking deeper for hostnames is opt-in (`includeHostnames`)
 * because it adds an N+1 round trip per site.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import { runAuthoringGraphQL } from "./graphql";

export type DiscoveredSite = {
  /** Item name (URL-safe slug). Used as the SXA site name. */
  name: string;
  /** Display name from the item, or the item name if not set. */
  displayName: string;
  /** Full Sitecore content path, e.g. `/sitecore/content/MyTenant/MySite`. */
  path: string;
  /** Parent tenant's item name. */
  tenantName: string;
  /** Parent tenant's full path. */
  tenantPath: string;
  /** Hostnames declared by `Settings/Site Grouping/<grouping>` items.
   *  Populated only when `includeHostnames: true` is requested. */
  hostnames?: string[];
};

export type DiscoverSitesOptions = {
  /** Resolve each site's hostnames from its Site Grouping sub-items.
   *  Adds N+1 GraphQL round trips. Defaults to false. */
  includeHostnames?: boolean;
  /** Override the content root walked. Default `/sitecore/content`.
   *  Useful for tests or for installations that nest content under a
   *  non-default root. */
  contentRoot?: string;
};

const DEFAULT_CONTENT_ROOT = "/sitecore/content";

const TENANT_TEMPLATE_NAMES = new Set([
  "Tenant",
  "Tenant Folder",
  "Headless Tenant",
  "Headless Tenant Folder",
]);
const SITE_TEMPLATE_NAMES = new Set(["Site", "Headless Site"]);
const SITE_GROUPING_NAMES = new Set(["Site Grouping"]);

const CHILDREN_QUERY = `
query($path: String!) {
  item(where: { path: $path }) {
    children {
      nodes {
        itemId
        name
        displayName
        path
        template {
          name
        }
      }
    }
  }
}`;

type ChildrenNode = {
  itemId: string;
  name: string;
  displayName: string | null;
  path: string;
  template: { name: string } | null;
};

type ChildrenResponse = {
  item: { children: { nodes: ChildrenNode[] } } | null;
};

const HOSTNAME_QUERY = `
query($path: String!) {
  item(where: { path: $path }) {
    fields(ownFields: false) {
      nodes {
        name
        value
      }
    }
  }
}`;

type FieldsResponse = {
  item: {
    fields: { nodes: Array<{ name: string; value: string | null }> };
  } | null;
};

const fetchChildren = async (
  environment: EnvironmentConfiguration,
  path: string
): Promise<ChildrenNode[]> => {
  const data = await runAuthoringGraphQL<ChildrenResponse>(environment, CHILDREN_QUERY, { path });
  return data.item?.children.nodes ?? [];
};

const fetchHostnames = async (
  environment: EnvironmentConfiguration,
  sitePath: string
): Promise<string[]> => {
  // Site groupings live at <site>/Settings/Site Grouping/<grouping>
  // and expose a `Hostname` field. Walk: site → settings → site
  // grouping container → grouping items → collect Hostname.
  const settings = await fetchChildren(environment, sitePath);
  const settingsItem = settings.find((node) => node.name === "Settings");
  if (!settingsItem) return [];
  const settingsChildren = await fetchChildren(environment, settingsItem.path);
  const groupingContainer = settingsChildren.find((node) => SITE_GROUPING_NAMES.has(node.name));
  if (!groupingContainer) return [];
  const groupings = await fetchChildren(environment, groupingContainer.path);
  const hostnames: string[] = [];
  for (const grouping of groupings) {
    const data = await runAuthoringGraphQL<FieldsResponse>(environment, HOSTNAME_QUERY, {
      path: grouping.path,
    });
    const value = data.item?.fields.nodes.find((field) => field.name === "Hostname")?.value;
    if (value && value.trim()) {
      // Hostname field is typically a single hostname or `|`-separated list.
      for (const host of value.split("|")) {
        const trimmed = host.trim();
        if (trimmed) hostnames.push(trimmed);
      }
    }
  }
  return hostnames;
};

const isTenantNode = (node: ChildrenNode): boolean =>
  TENANT_TEMPLATE_NAMES.has(node.template?.name ?? "");

const isSiteNode = (node: ChildrenNode): boolean =>
  SITE_TEMPLATE_NAMES.has(node.template?.name ?? "");

export const discoverSites = async (
  environment: EnvironmentConfiguration,
  options: DiscoverSitesOptions = {}
): Promise<DiscoveredSite[]> => {
  const contentRoot = options.contentRoot ?? DEFAULT_CONTENT_ROOT;
  const tenantCandidates = await fetchChildren(environment, contentRoot);
  // SXA convention: top-level items under /sitecore/content are tenants.
  // Some installations have non-tenant items here too (e.g. legacy "Home")
  // — filter by template name to skip them.
  const tenants = tenantCandidates.filter(isTenantNode);

  const sites: DiscoveredSite[] = [];
  for (const tenant of tenants) {
    const tenantChildren = await fetchChildren(environment, tenant.path);
    for (const child of tenantChildren) {
      if (!isSiteNode(child)) continue;
      const site: DiscoveredSite = {
        name: child.name,
        displayName: child.displayName?.trim() || child.name,
        path: child.path,
        tenantName: tenant.name,
        tenantPath: tenant.path,
      };
      if (options.includeHostnames) {
        site.hostnames = await fetchHostnames(environment, child.path);
      }
      sites.push(site);
    }
  }
  return sites;
};
