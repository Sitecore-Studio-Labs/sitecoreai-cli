import { resolveEnvironment } from "../src/policy/environment";
import { createAuthoringClient } from "../src/recipe/api/authoring-client";

const profileName = process.env.RECIPE_TEST_ENV_PROFILE ?? "TestDemo";
const { environment } = resolveEnvironment({
  environmentName: profileName,
  skipPolicy: true,
});
const authoring = createAuthoringClient({ environment });

const projectRoot = await authoring.getItem({
  path: "/sitecore/system/Settings/Project",
  includeChildren: true,
});

if (!projectRoot || !projectRoot.children) {
  console.error("Project root not found");
  process.exit(1);
}

const orphans = projectRoot.children.filter((c) => c.name.startsWith("E2eCollection"));
console.log(`Found ${orphans.length} orphan E2eCollection items`);

for (const child of orphans) {
  console.log(`Deleting ${child.path} (${child.itemId})`);
  try {
    await authoring.deleteItem({ itemId: child.itemId, permanent: true });
    console.log("  -> ok");
  } catch (e) {
    console.error("  -> failed:", (e as Error).message);
  }
}
