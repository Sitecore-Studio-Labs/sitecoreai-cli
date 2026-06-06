/**
 * Walk the SXA Scaffolding tree to find where AddItem, EditSiteItem,
 * EditTenantTemplate templates actually live on the tenant.
 */
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const client = createAuthoringClient({ environment });

  // Walk under JSS Experience Accelerator/Scaffolding to find action templates.
  const candidates = [
    "/sitecore/templates/Foundation/JSS Experience Accelerator/Scaffolding",
    "/sitecore/templates/Foundation/Experience Accelerator/Scaffolding",
    "/sitecore/templates/Foundation/JSS Experience Accelerator",
    "/sitecore/templates/Foundation/Experience Accelerator",
    "/sitecore/templates/Foundation",
  ];
  for (const p of candidates) {
    const item = await client.getItem({ path: p });
    console.log(p, "→", item ? `OK (${item.itemId})` : "NOT FOUND");
  }

  console.log("\n--- Foundation/Experience Accelerator subtree ---");
  const root = await client.getItem({ path: "/sitecore/templates/Foundation" });
  if (root) {
    const children = await client.getChildren({ itemId: root.itemId });
    for (const c of children) {
      console.log(`  - ${c.name} (template=${c.templateId})`);
    }
  }

  // Find AddItem directly via name match
  console.log("\n--- search for AddItem under /sitecore/templates ---");
  const walk = async (path: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    const item = await client.getItem({ path });
    if (!item) return;
    if (
      ["AddItem", "EditSiteItem", "EditTenantTemplate", "ExecuteScript", "PostSetupStep"].includes(
        item.name
      )
    ) {
      console.log(`  FOUND: ${path}`);
    }
    const children = await client.getChildren({ itemId: item.itemId });
    for (const c of children) {
      await walk(`${path}/${c.name}`, depth + 1);
    }
  };
  await walk("/sitecore/templates/Foundation", 0);
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
