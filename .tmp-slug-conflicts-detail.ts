import {
  resolveTenant,
  scanItemsAndFields,
  extractInternalRefs,
} from "@/hygiene/tasks/shared";

const OLDER_STYLES_ROOT = "dd71dc1d5b614e77a5773432e29b0eb2";
const NEWER_STYLES_ROOT = "edab9969a5db4079aa843ec6f5faa4a3";

// The 14 "newer" (delete candidate) itemIds — also includes the newer styles root.
const DELETE_CANDIDATES = new Set<string>([
  "edab9969a5db4079aa843ec6f5faa4a3", "17bafdf6a6d4418693169ede7fa49820",
  "aacae1c8dbab4726918ade2fefa0f115", "27eb07e18acc4d729e42a5677e9a8d70",
  "316b4966c4a24542adcceb72b65ec38e", "55216261bfcb425588740565fb0de903",
  "15cb98e2e8a146c1854a06a58a7b7813", "6bed3e1a3dbf43d39505ab45f5682d2e",
  "2026a235d9e64cf7b621ad7bf5ae2993", "d4f853d6620f4835bbcd0fd5d76d1aac",
  "b09ade6f96e1441ca658e2546657f338", "46bb6f26e6214fe9963d84a957667793",
  "cdcf6f01d2674bf3ba599b81aa2e971e", "dafaaa9dc6d7459c94a1e631da1630ee",
]);

const KEEP_ITEMS = new Set<string>([
  "dd71dc1d5b614e77a5773432e29b0eb2", "fe0ee14e8ca24ebba66e136ff3c770bf",
  "212ce75dcf7e40ebb19900f4ae6664fd", "67f1ac04f2a740ac9923a268a8c97d78",
  "fad1cb1fdbc84231ba489f5da2bee4aa", "479c0dd06ff94703a7b419a7e4897739",
  "8285deb77ac6492f8bbfbb5cc4cd73fb", "91862f75f04542e48910e67dd84317a9",
  "2aa96f89db864cb4affd0a89a7ce3d21", "00bedc810083415fae7a581e00b33b4e",
  "b22b009f86ad404b839140ad6b8921af", "a2c27b9a55154a558889cdb60190cf18",
  "1b9c5f91fc0546189ac9f395042c8395", "08b66a999f00458781ceec14cdaea764",
]);

const normalize = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Step 1: recursively walk from each styles root → list descendants.
  const walk = async (rootId: string): Promise<Array<{ itemId: string; path: string; name: string }>> => {
    const out: Array<{ itemId: string; path: string; name: string }> = [];
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const kids = await client.getChildren({ itemId: id });
      for (const k of kids) {
        const norm = normalize(k.itemId);
        out.push({ itemId: norm, path: k.path, name: k.name });
        stack.push(norm);
      }
    }
    return out;
  };

  const [olderDesc, newerDesc] = await Promise.all([walk(OLDER_STYLES_ROOT), walk(NEWER_STYLES_ROOT)]);

  console.log(`\n=== OLDER root subtree (${OLDER_STYLES_ROOT}) — keep ===`);
  console.log(`  ${olderDesc.length} descendants`);
  for (const d of olderDesc.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    const tag = KEEP_ITEMS.has(d.itemId) ? "  KEEP" : DELETE_CANDIDATES.has(d.itemId) ? "  ⚠ DELETE!?" : "";
    console.log(`    ${d.itemId}  ${d.path}${tag}`);
  }

  console.log(`\n=== NEWER root subtree (${NEWER_STYLES_ROOT}) — delete ===`);
  console.log(`  ${newerDesc.length} descendants`);
  for (const d of newerDesc.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    const tag = DELETE_CANDIDATES.has(d.itemId) ? "  DELETE" : KEEP_ITEMS.has(d.itemId) ? "  ⚠ KEEP!?" : "";
    console.log(`    ${d.itemId}  ${d.path}${tag}`);
  }

  // Step 2: reference scan — find anything that links to a delete-candidate.
  console.log("\n=== Reference scan ===");
  const { scanned, fieldsByItemId } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore/content",
    logger: { verbose: () => {}, warn: () => {} } as any,
    options: { concurrency: 8, batchSize: 50, pageParallelism: 4 },
    latestVersionOnly: true,
  });

  // Also include the full set of newer-subtree descendants in the "to-delete" check.
  const allToDelete = new Set([...DELETE_CANDIDATES, ...newerDesc.map((d) => d.itemId)]);

  const incoming: Array<{ srcId: string; srcPath: string; fieldName: string; targetId: string }> = [];
  for (const s of scanned) {
    if (allToDelete.has(s.itemId)) continue; // skip self-refs from within the to-delete subtree
    const fields = fieldsByItemId.get(s.itemId);
    if (!fields) continue;
    for (const f of fields) {
      if (!f.value) continue;
      for (const ref of extractInternalRefs(f.value)) {
        if (allToDelete.has(ref)) {
          incoming.push({ srcId: s.itemId, srcPath: s.path, fieldName: f.name, targetId: ref });
        }
      }
    }
  }

  if (incoming.length === 0) {
    console.log("  ✓ No external references to any of the to-delete items. Safe to delete.");
  } else {
    console.log(`  ⚠ Found ${incoming.length} reference(s) from outside the to-delete subtree:`);
    for (const r of incoming) {
      console.log(`    ${r.srcPath}  field=${r.fieldName} → ${r.targetId}`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
