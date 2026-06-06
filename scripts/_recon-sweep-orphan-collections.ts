import { resolveEnvironment } from "../src/policy/environment";
import { createAuthoringClient } from "../src/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const profileName = process.env.RECIPE_TEST_ENV_PROFILE ?? "TestDemo";
  const { environment } = resolveEnvironment({
    environmentName: profileName,
    skipPolicy: true,
  });
  const authoring = createAuthoringClient({ environment });

  const projectRoot = await authoring.getItem({
    path: "/sitecore/system/Settings/Project",
  });

  if (!projectRoot) {
    console.error("Project root not found");
    process.exit(1);
  }

  const children = await authoring.getChildren({ itemId: projectRoot.itemId });
  const orphans = children.filter((c) => c.name.startsWith("E2eCollection"));
  console.log(`Found ${orphans.length} orphan E2eCollection items`);

  for (const child of orphans) {
    // Hard guard: only delete items whose name starts with `E2eCollection`.
    // Defensive even though the filter above already enforces this — a
    // future refactor of the filter shouldn't open the door to deleting
    // anything else.
    if (!child.name.startsWith("E2eCollection")) {
      console.error(`Refusing to delete '${child.name}' — not E2eCollection-prefixed`);
      continue;
    }
    console.log(`Deleting ${child.path} (${child.itemId})`);
    try {
      await authoring.deleteItem({ itemId: child.itemId });
      console.log("  -> ok");
    } catch (e) {
      console.error("  -> failed:", (e as Error).message);
    }
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
