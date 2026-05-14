import { resolveTenant } from "@/hygiene/tasks/shared";

const SITE_HOLDER_ROOTS = [
  "/sitecore/content",
  "/sitecore/templates/Project",
  "/sitecore/layout/Renderings/Project",
  "/sitecore/media library/Project",
  "/sitecore/system/Settings/Foundation/Experience Accelerator",
];

// Well-known platform/system children to exclude from "looks like a tenant" candidates.
const SYSTEM_CHILDREN = new Set([
  "applications",
  "common",
  "experience accelerator",
  "feature",
  "foundation",
  "project",
  "sample",
  "sitecore",
  "system",
  "branches",
  "modules",
]);

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Step 1: pull the list of ACTIVE sites + tenants via SXA grouping items
  // (Sites have a "Site Settings" item whose path includes the tenant + site name.)
  // For this quick audit, use the deploy site list we already know:
  const activeSites = [
    { tenant: "demo-registry", site: "content-modelling" },
    { tenant: "example", site: "test-sync" },
  ];
  const activeTenantSet = new Set(activeSites.map((s) => s.tenant.toLowerCase()));
  const activeSiteSet = new Set(activeSites.map((s) => `${s.tenant.toLowerCase()}/${s.site.toLowerCase()}`));

  console.log("Active sites (from deploy site list):");
  for (const s of activeSites) console.log(`  ${s.tenant}/${s.site}`);

  for (const root of SITE_HOLDER_ROOTS) {
    console.log(`\n=== ${root} ===`);
    let rootChildren: any[] = [];
    try {
      rootChildren = await client.getChildren({ path: root });
    } catch (err: any) {
      console.log(`  (root not found or error: ${err?.message ?? err})`);
      continue;
    }
    if (rootChildren.length === 0) {
      console.log("  (empty)");
      continue;
    }

    for (const tenantItem of rootChildren) {
      const tenantName = tenantItem.name.toLowerCase();
      if (SYSTEM_CHILDREN.has(tenantName)) continue;

      // Each tenant has site folders as direct children.
      let siteChildren: any[] = [];
      try {
        siteChildren = await client.getChildren({ itemId: tenantItem.itemId });
      } catch {
        siteChildren = [];
      }

      const orphanSites: string[] = [];
      const activeSitesInTenant: string[] = [];
      for (const siteItem of siteChildren) {
        const siteName = siteItem.name.toLowerCase();
        const key = `${tenantName}/${siteName}`;
        if (activeSiteSet.has(key)) {
          activeSitesInTenant.push(siteItem.name);
        } else {
          orphanSites.push(siteItem.name);
        }
      }

      const tenantStatus = activeTenantSet.has(tenantName)
        ? activeSitesInTenant.length > 0
          ? "active"
          : "tenant active but no active sites here"
        : "orphan tenant";

      console.log(`  ${tenantItem.name} [${tenantStatus}]`);
      if (activeSitesInTenant.length > 0) console.log(`    active: ${activeSitesInTenant.join(", ")}`);
      if (orphanSites.length > 0) console.log(`    orphan: ${orphanSites.join(", ")}`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
