import { resolveTenant } from "@/hygiene/tasks/shared";

const STRAGGLER_PATHS = [
  "/sitecore/templates/Project/demo-registry/Datasources",
  "/sitecore/templates/Project/demo-registry/Datasources/Card",
  "/sitecore/templates/Project/demo-registry/Datasources/Button",
  "/sitecore/templates/Project/demo-registry/Datasources/Text",
  "/sitecore/templates/Project/demo-registry/Datasources/Button Folder",
  "/sitecore/templates/Project/demo-registry/Article Card",
  "/sitecore/templates/Project/demo-registry/Articles",
  "/sitecore/templates/Project/demo-registry/Badge",
  "/sitecore/templates/Project/demo-registry/Offer Card_2",
  "/sitecore/templates/Project/demo-registry/Offers",
  "/sitecore/templates/Project/demo-registry/Image",
  "/sitecore/templates/Project/demo-registry/Headless Tenant",
  "/sitecore/templates/Project/demo-registry/Offer Card",
  "/sitecore/templates/Project/example/Headless Tenant",
  "/sitecore/templates/Project/example/Page Folder",
  "/sitecore/templates/Project/Presentation",
  "/sitecore/templates/Project/Presentation/Enumeration",
  "/sitecore/templates/Project/Presentation/Enumerations Folder",
];

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });
  const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();
  console.log("Checking actual existence + retrying deletes…");
  let stillExists = 0;
  let nowGone = 0;
  let deleted = 0;
  for (const p of STRAGGLER_PATHS) {
    const fields = await client.getItemFields({ path: p });
    if (!fields) {
      console.log(`  · ${p}: already gone`);
      nowGone += 1;
      continue;
    }
    // Try a delete.
    const page = await client.search({
      paging: { pageSize: 5 },
      latestVersionOnly: true,
      searchStatement: {
        criteria: { field: "_fullpath", value: p.toLowerCase(), criteriaType: "EXACT" },
      },
    });
    const id = page.results[0]?.itemId;
    if (!id) {
      console.log(`  ? ${p}: fields fetched but no search match`);
      continue;
    }
    try {
      await client.deleteItem({ itemId: norm(id), permanently: true });
      console.log(`  ✓ ${p}: deleted on retry`);
      deleted += 1;
    } catch (err: any) {
      console.log(`  ✗ ${p}: ${String(err?.message ?? err).slice(0, 120)}`);
      stillExists += 1;
    }
  }
  console.log(`\nGone already: ${nowGone}; deleted this pass: ${deleted}; still failing: ${stillExists}`);
};

main().catch((err) => console.error(err?.stack ?? err));
