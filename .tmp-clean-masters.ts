import {
  resolveTenant,
  scanItemsAndFields,
  extractInternalRefs,
} from "@/hygiene/tasks/shared";

const ACTIVE_CONTENT_ROOTS = [
  "/sitecore/content/example/test-sync",
  "/sitecore/content/demo-registry/content-modelling",
];

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Step 1: collect every itemId in /sitecore/templates/Project/ui
  const { scanned: uiSubtree } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore/templates/Project/ui",
    logger: { verbose: () => {}, warn: () => {} } as any,
    options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
    latestVersionOnly: true,
    skipFields: true,
  });
  const uiIds = new Set(uiSubtree.map((s) => norm(s.itemId)));
  console.log(`ui subtree: ${uiIds.size} items`);

  // Step 2: scan active content; for every field that contains a ref into uiIds,
  // strip just those refs while preserving the rest.
  console.log("\n=== Finding fields with ui-pointing refs ===");
  type FixCandidate = {
    itemId: string;
    itemPath: string;
    fieldName: string;
    originalValue: string;
    newValue: string;
    removedRefs: string[];
  };
  const fixes: FixCandidate[] = [];

  for (const root of ACTIVE_CONTENT_ROOTS) {
    const { scanned, fieldsByItemId } = await scanItemsAndFields({
      client,
      envName,
      root,
      logger: { verbose: () => {}, warn: () => {} } as any,
      options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 10000 },
      latestVersionOnly: true,
    });
    for (const s of scanned) {
      const fields = fieldsByItemId.get(s.itemId);
      if (!fields) continue;
      for (const f of fields) {
        if (!f.value) continue;
        const refs = extractInternalRefs(f.value);
        const refsInUi = refs.filter((r) => uiIds.has(r));
        if (refsInUi.length === 0) continue;

        // Strip the offending refs. The values are typically pipe-delimited
        // GUIDs with optional braces. Remove tokens whose GUID matches.
        const pieces = f.value.split("|");
        const kept: string[] = [];
        const removed: string[] = [];
        for (const p of pieces) {
          const m = p.match(
            /\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?/i
          );
          if (m) {
            const id = norm(m[1] + m[2] + m[3] + m[4] + m[5]);
            if (uiIds.has(id)) {
              removed.push(p);
              continue;
            }
          }
          kept.push(p);
        }
        if (removed.length === 0) continue; // didn't match the pipe-delimited shape
        const newValue = kept.join("|");
        fixes.push({
          itemId: s.itemId,
          itemPath: s.path,
          fieldName: f.name,
          originalValue: f.value,
          newValue,
          removedRefs: removed,
        });
      }
    }
  }

  console.log(`Found ${fixes.length} fields to fix\n`);
  for (const fix of fixes) {
    console.log(`  ${fix.itemPath}.${fix.fieldName}`);
    console.log(`    before: ${fix.originalValue.slice(0, 100)}${fix.originalValue.length > 100 ? "…" : ""}`);
    console.log(`    after:  ${fix.newValue.slice(0, 100) || "(empty)"}`);
    console.log(`    removed: ${fix.removedRefs.join(", ")}`);
  }

  // Step 3: apply the fixes
  console.log("\n=== Applying fixes ===");
  let ok = 0;
  for (const fix of fixes) {
    try {
      await client.updateItemFields({
        itemId: fix.itemId,
        fields: [{ name: fix.fieldName, value: fix.newValue }],
      });
      ok += 1;
      console.log(`  ✓ ${fix.itemPath}.${fix.fieldName}`);
    } catch (err: any) {
      console.log(`  ✗ ${fix.itemPath}.${fix.fieldName}: ${err?.message ?? err}`);
    }
  }
  console.log(`\nFixed ${ok} / ${fixes.length} fields.`);

  if (ok < fixes.length) {
    console.log("Aborting ui delete because some fixes failed.");
    return;
  }

  // Step 4: delete ui
  console.log("\n=== Deleting /sitecore/templates/Project/ui ===");
  try {
    await client.deleteItem({ itemId: "77b59280ee684047a8951fcb4044dec8", permanently: true });
    console.log("  ✓ ui deleted");
  } catch (err: any) {
    console.log(`  ✗ ${err?.message ?? err}`);
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
