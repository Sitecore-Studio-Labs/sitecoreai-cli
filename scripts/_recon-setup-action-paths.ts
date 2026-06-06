import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const client = createAuthoringClient({ environment });
  const paths = [
    "/sitecore/templates/Foundation/JSS Experience Accelerator/Scaffolding/Actions/Site/AddItem",
    "/sitecore/templates/Foundation/JSS Experience Accelerator/Scaffolding/Actions/Site/EditSiteItem",
    "/sitecore/templates/Foundation/JSS Experience Accelerator/Scaffolding/Actions/Tenant/EditTenantTemplate",
    "/sitecore/templates/Foundation/JSS Experience Accelerator/Scaffolding/Actions/Site/ExecuteScript",
    "/sitecore/templates/Foundation/JSS Experience Accelerator/Scaffolding/Actions/Site/PostSetupStep",
  ];
  for (const p of paths) {
    const item = await client.getItem({ path: p });
    console.log(p, "→", item ? item.itemId : "NOT FOUND");
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
