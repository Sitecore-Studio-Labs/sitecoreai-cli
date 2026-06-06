import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const client = createAuthoringClient({ environment });
  const folder = await client.getItem({
    path: "/sitecore/system/Settings/Project/click-click-launch/Templates/Modules",
  });
  if (!folder) {
    console.log("no Modules folder");
    return;
  }
  const children = await client.getChildren({ itemId: folder.itemId });
  for (const c of children) {
    console.log(c.name, c.itemId);
    const sub = await client.getChildren({ itemId: c.itemId });
    console.log("  children:", sub.length);
    for (const s of sub) console.log("   -", s.name, "template:", s.templateId);
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
