import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

// "template is used" blockers from Stage 2 — these passed the safety check
// (no active content templated by them) but the API still refused delete.
const BLOCKERS = [
  { name: "Datasources", path: "/sitecore/templates/Project/demo-registry/Datasources" },
  { name: "Article Card", path: "/sitecore/templates/Project/demo-registry/Article Card" },
  { name: "Articles", path: "/sitecore/templates/Project/demo-registry/Articles" },
  { name: "Badge", path: "/sitecore/templates/Project/demo-registry/Badge" },
  { name: "Offer Card_2", path: "/sitecore/templates/Project/demo-registry/Offer Card_2" },
  { name: "Offers", path: "/sitecore/templates/Project/demo-registry/Offers" },
  { name: "Image (demo-registry)", path: "/sitecore/templates/Project/demo-registry/Image" },
  { name: "Article Card Folder", path: "/sitecore/templates/Project/demo-registry/Article Card Folder" },
  { name: "Articles Folder", path: "/sitecore/templates/Project/demo-registry/Articles Folder" },
  { name: "Badge Folder", path: "/sitecore/templates/Project/demo-registry/Badge Folder" },
  { name: "Image Folder", path: "/sitecore/templates/Project/demo-registry/Image Folder" },
  { name: "Offer Card Folder", path: "/sitecore/templates/Project/demo-registry/Offer Card Folder" },
  { name: "Offers Folder", path: "/sitecore/templates/Project/demo-registry/Offers Folder" },
  { name: "Headless Tenant (demo-registry)", path: "/sitecore/templates/Project/demo-registry/Headless Tenant" },
  { name: "Offer Card", path: "/sitecore/templates/Project/demo-registry/Offer Card" },
  { name: "Headless Tenant (example)", path: "/sitecore/templates/Project/example/Headless Tenant" },
  { name: "Page Folder (example)", path: "/sitecore/templates/Project/example/Page Folder" },
  { name: "accordion-item", path: "/sitecore/templates/Project/accordion-item" },
  { name: "CtaButton", path: "/sitecore/templates/Project/CtaButton" },
  { name: "CtaButton Parameters", path: "/sitecore/templates/Project/CtaButton Parameters" },
  { name: "Presentation", path: "/sitecore/templates/Project/Presentation" },
];

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Step 1: enumerate every itemId in each blocker subtree, group by blocker.
  const blockerIds = new Map<string, Set<string>>(); // blocker name -> ids in its subtree
  const idToBlocker = new Map<string, string>();
  for (const b of BLOCKERS) {
    try {
      const { scanned } = await scanItemsAndFields({
        client,
        envName,
        root: b.path,
        logger: { verbose: () => {}, warn: () => {} } as any,
        options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
        latestVersionOnly: true,
        skipFields: true,
      });
      const ids = new Set(scanned.map((s) => norm(s.itemId)));
      blockerIds.set(b.name, ids);
      for (const id of ids) idToBlocker.set(id, b.name);
      console.log(`${b.name}: ${ids.size} items`);
    } catch (err: any) {
      console.log(`${b.name}: scan failed (${err?.message ?? err})`);
    }
  }

  const allBlockedIds = new Set<string>(idToBlocker.keys());
  console.log(`\nTotal blocker itemIds: ${allBlockedIds.size}`);

  // Step 2: one full /sitecore scan; collect every (item, field) referencing a blocked id.
  console.log("\nScanning /sitecore for refs into blocker subtrees…");
  const { scanned, fieldsByItemId } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore",
    logger: { verbose: (m) => process.stderr.write(`V: ${m}\n`), warn: () => {} } as any,
    options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 50000, includeSystem: true },
    latestVersionOnly: true,
  });
  console.log(`scanned ${scanned.length} items`);

  type Hit = {
    srcPath: string;
    srcInWhichBlocker: string | null; // if the source is INSIDE a blocked subtree, name it
    fieldName: string;
    refIds: string[];
    blockedRefIds: string[];
    value: string;
  };
  const hits: Hit[] = [];
  const re = /\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?/gi;
  for (const s of scanned) {
    const fields = fieldsByItemId.get(s.itemId);
    if (!fields) continue;
    for (const f of fields) {
      if (!f.value) continue;
      re.lastIndex = 0;
      const refs: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.value))) {
        refs.push(norm(m[1] + m[2] + m[3] + m[4] + m[5]));
      }
      const blocked = refs.filter((r) => allBlockedIds.has(r));
      if (blocked.length === 0) continue;
      hits.push({
        srcPath: s.path,
        srcInWhichBlocker: idToBlocker.get(norm(s.itemId)) ?? null,
        fieldName: f.name,
        refIds: refs,
        blockedRefIds: blocked,
        value: f.value.slice(0, 200),
      });
    }
  }

  // Step 3: categorize hits — internal-to-blocker (will go when blocker goes)
  // vs external (need to strip or preserve).
  const internal = hits.filter((h) => h.srcInWhichBlocker !== null);
  const external = hits.filter((h) => h.srcInWhichBlocker === null);

  console.log(`\nInternal refs (inside a blocker subtree): ${internal.length}`);
  console.log(`External refs (outside any blocker): ${external.length}`);

  if (external.length > 0) {
    console.log("\n=== External refs (these block the deletes) ===");
    for (const h of external) {
      const blockers = [...new Set(h.blockedRefIds.map((r) => idToBlocker.get(r) ?? "?"))];
      console.log(`\n  src: ${h.srcPath}`);
      console.log(`    field: ${h.fieldName}`);
      console.log(`    value: ${h.value}`);
      console.log(`    points into: ${blockers.join(", ")}`);
    }
  }

  if (internal.length > 0) {
    console.log("\n=== Internal refs by blocker (will cascade-delete OK if we clear them) ===");
    const byBlocker = new Map<string, Hit[]>();
    for (const h of internal) {
      if (!byBlocker.has(h.srcInWhichBlocker!)) byBlocker.set(h.srcInWhichBlocker!, []);
      byBlocker.get(h.srcInWhichBlocker!)!.push(h);
    }
    for (const [b, hs] of byBlocker) {
      console.log(`\n  ${b}: ${hs.length} internal refs`);
      for (const h of hs.slice(0, 5)) {
        console.log(`    ${h.srcPath}.${h.fieldName}`);
      }
      if (hs.length > 5) console.log(`    …and ${hs.length - 5} more`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
