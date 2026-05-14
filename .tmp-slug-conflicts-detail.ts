import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

const CONFLICT_IDS = new Set(
  [
    "edab9969a5db4079aa843ec6f5faa4a3", "dd71dc1d5b614e77a5773432e29b0eb2",
    "15cb98e2e8a146c1854a06a58a7b7813", "8285deb77ac6492f8bbfbb5cc4cd73fb",
    "b09ade6f96e1441ca658e2546657f338", "b22b009f86ad404b839140ad6b8921af",
    "17bafdf6a6d4418693169ede7fa49820", "fe0ee14e8ca24ebba66e136ff3c770bf",
    "316b4966c4a24542adcceb72b65ec38e", "fad1cb1fdbc84231ba489f5da2bee4aa",
    "cdcf6f01d2674bf3ba599b81aa2e971e", "1b9c5f91fc0546189ac9f395042c8395",
    "27eb07e18acc4d729e42a5677e9a8d70", "67f1ac04f2a740ac9923a268a8c97d78",
    "aacae1c8dbab4726918ade2fefa0f115", "212ce75dcf7e40ebb19900f4ae6664fd",
    "55216261bfcb425588740565fb0de903", "479c0dd06ff94703a7b419a7e4897739",
    "2026a235d9e64cf7b621ad7bf5ae2993", "2aa96f89db864cb4affd0a89a7ce3d21",
    "6bed3e1a3dbf43d39505ab45f5682d2e", "91862f75f04542e48910e67dd84317a9",
    "d4f853d6620f4835bbcd0fd5d76d1aac", "00bedc810083415fae7a581e00b33b4e",
    "46bb6f26e6214fe9963d84a957667793", "a2c27b9a55154a558889cdb60190cf18",
    "dafaaa9dc6d7459c94a1e631da1630ee", "08b66a999f00458781ceec14cdaea764",
  ]
);

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });
  // Scan from /sitecore/content (whole tree) just like the slug-conflicts audit does.
  const { scanned } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore/content",
    logger: { verbose: () => {}, warn: () => {} } as any,
    options: { concurrency: 8, batchSize: 50, pageParallelism: 4 },
    latestVersionOnly: true,
    skipFields: true,
  });
  const byId = new Map<string, any>();
  for (const s of scanned) byId.set(s.itemId, s);

  console.log(`scanned ${scanned.length} items; found conflict items: ${[...CONFLICT_IDS].filter((id) => byId.has(id)).length}/${CONFLICT_IDS.size}`);

  // Group by path; print each conflicting group with createdDate for both members.
  const byPath = new Map<string, any[]>();
  for (const id of CONFLICT_IDS) {
    const s = byId.get(id);
    if (!s) continue;
    const arr = byPath.get(s.path) ?? [];
    arr.push(s);
    byPath.set(s.path, arr);
  }
  const sortedPaths = [...byPath.keys()].sort();
  for (const p of sortedPaths) {
    const items = byPath.get(p)!;
    console.log(`\n--- ${p} (${items.length} member${items.length === 1 ? "" : "s"}) ---`);
    for (const it of items.sort((a, b) => String(a.createdDate ?? "").localeCompare(String(b.createdDate ?? "")))) {
      console.log(`  ${it.itemId}  created=${it.createdDate}  updated=${it.updatedDate}`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
