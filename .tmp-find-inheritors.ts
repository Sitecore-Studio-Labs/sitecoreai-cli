import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

const TARGET_IDS = new Set([
  "4d57c4f12f87460190ce895dcfe8b519", // accordion-block
  "f29336deeff4485ba0393d8cd6ad61a7", // avatar-block
  "e5af3a777c6745b3812783ad3e8957d5", // badge-block
  "d6ccc20205144697a31cb5bfb1a36c69", // card-block
  "d5045f52e27645c09d396fc48fc879d0", // cta-button
  "6ac5404af99c49d69e40513219704d37", // rich-text-block
  "77b59280ee684047a8951fcb4044dec8", // ui folder
]);

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Scan the whole /sitecore tree's templates + content for any item whose
  // __Base templates field contains one of our targets.
  // Use master DB root.
  console.log("Scanning entire /sitecore for items with __Base templates referencing ui targets…");
  const { scanned, fieldsByItemId } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore",
    logger: { verbose: (m) => process.stderr.write(`V: ${m}\n`), warn: () => {} } as any,
    options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 50000, includeSystem: true },
    latestVersionOnly: true,
  });
  console.log(`scanned ${scanned.length} items`);

  const hits: Array<{ path: string; fieldName: string; value: string; matches: string[] }> = [];
  for (const s of scanned) {
    const fields = fieldsByItemId.get(s.itemId);
    if (!fields) continue;
    for (const f of fields) {
      if (!f.value) continue;
      // Check any base-template-like field
      const fname = f.name.toLowerCase();
      if (!fname.includes("base") && !fname.includes("template")) continue;
      const matches: string[] = [];
      const re = /\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.value))) {
        const id = norm(m[1] + m[2] + m[3] + m[4] + m[5]);
        if (TARGET_IDS.has(id)) matches.push(id);
      }
      if (matches.length > 0) {
        hits.push({ path: s.path, fieldName: f.name, value: f.value.slice(0, 200), matches });
      }
    }
  }

  if (hits.length === 0) {
    console.log("\nNo __Base templates references found pointing into ui targets.");
  } else {
    console.log(`\nFound ${hits.length} hits:`);
    for (const h of hits) {
      console.log(`\n  ${h.path}`);
      console.log(`    field: ${h.fieldName}`);
      console.log(`    value: ${h.value}`);
      console.log(`    matches: ${h.matches.join(", ")}`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
