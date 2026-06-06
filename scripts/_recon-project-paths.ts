import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const client = createAuthoringClient({ environment });
  for (const p of [
    "/sitecore/system/Settings/Project",
    "/sitecore/system/Settings/Project/click-click-launch",
    "/sitecore/system/Settings/Project/click-click-launch/Templates",
  ]) {
    const item = await client.getItem({ path: p });
    console.log(p, "→", item ? item.itemId : "NOT FOUND");
  }
  const projects = await client.getItem({ path: "/sitecore/system/Settings/Project" });
  if (projects) {
    const children = await client.getChildren({ itemId: projects.itemId });
    console.log("\nProject subfolders:");
    for (const c of children) console.log(" -", c.name);
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
