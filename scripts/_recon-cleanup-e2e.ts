import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const client = createAuthoringClient({ environment });

  // Walk well-known test paths and delete each.
  const paths = ["/sitecore/templates/Project/scai-e2e", "/sitecore/media library/SiteTemplates"];
  for (const p of paths) {
    const item = await client.getItem({ path: p });
    if (item) {
      console.log(`Deleting ${p} (${item.itemId})`);
      await client.deleteItem({ itemId: item.itemId });
    } else {
      console.log(`${p} not found`);
    }
  }
  // Also find any leftover E2eTemplate* items under the Settings project
  // templates path or modules folder.
  const tplParent = await client.getItem({
    path: "/sitecore/system/Settings/Project/click-click-launch/Templates",
  });
  if (tplParent) {
    const children = await client.getChildren({ itemId: tplParent.itemId });
    for (const c of children) {
      if (c.name.startsWith("E2eTemplate")) {
        console.log(`Deleting tenant Templates child ${c.name} (${c.itemId})`);
        await client.deleteItem({ itemId: c.itemId });
      }
    }
  }
  const modulesParent = await client.getItem({
    path: "/sitecore/system/Settings/Project/click-click-launch/Templates/Modules",
  });
  if (modulesParent) {
    console.log(`Deleting Modules parent (${modulesParent.itemId})`);
    await client.deleteItem({ itemId: modulesParent.itemId });
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
