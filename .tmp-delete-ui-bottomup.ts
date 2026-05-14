import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  const { scanned } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore/templates/Project/ui",
    logger: { verbose: () => {}, warn: () => {} } as any,
    options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
    latestVersionOnly: true,
    skipFields: true,
  });

  console.log(`ui subtree: ${scanned.length} items`);

  // Sort by path depth descending — deepest leaves first.
  const sorted = [...scanned].sort((a, b) => b.path.split("/").length - a.path.split("/").length);

  let ok = 0;
  let failed = 0;
  for (const item of sorted) {
    try {
      await client.deleteItem({ itemId: item.itemId, permanently: true });
      ok += 1;
    } catch (err: any) {
      failed += 1;
      console.log(`  ✗ ${item.path}: ${err?.message ?? err}`);
    }
  }
  console.log(`\nDeleted ${ok} / ${scanned.length}. Failed: ${failed}.`);

  // Confirm by re-scanning.
  try {
    const after = await scanItemsAndFields({
      client,
      envName,
      root: "/sitecore/templates/Project/ui",
      logger: { verbose: () => {}, warn: () => {} } as any,
      options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
      latestVersionOnly: true,
      skipFields: true,
    });
    console.log(`\nPost-delete: ${after.scanned.length} items remain in ui subtree`);
  } catch {
    console.log("\nPost-delete: ui no longer exists ✓");
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
