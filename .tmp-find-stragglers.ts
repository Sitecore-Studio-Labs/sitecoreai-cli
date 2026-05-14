import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

const STRAGGLER_PATHS = [
  "/sitecore/templates/Project/demo-registry/Datasources",
  "/sitecore/templates/Project/demo-registry/Datasources/Card",
  "/sitecore/templates/Project/demo-registry/Datasources/Button",
  "/sitecore/templates/Project/demo-registry/Datasources/Text",
  "/sitecore/templates/Project/demo-registry/Datasources/Button Folder",
  "/sitecore/templates/Project/demo-registry/Article Card",
  "/sitecore/templates/Project/demo-registry/Articles",
  "/sitecore/templates/Project/demo-registry/Badge",
  "/sitecore/templates/Project/demo-registry/Offer Card_2",
  "/sitecore/templates/Project/demo-registry/Offers",
  "/sitecore/templates/Project/demo-registry/Image",
  "/sitecore/templates/Project/demo-registry/Headless Tenant",
  "/sitecore/templates/Project/demo-registry/Offer Card",
  "/sitecore/templates/Project/example/Headless Tenant",
  "/sitecore/templates/Project/example/Page Folder",
  "/sitecore/templates/Project/Presentation",
  "/sitecore/templates/Project/Presentation/Enumeration",
  "/sitecore/templates/Project/Presentation/Enumerations Folder",
];

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Resolve straggler paths to itemIds.
  const stragglerIds = new Map<string, string>(); // itemId -> path
  for (const p of STRAGGLER_PATHS) {
    const page = await client.search({
      paging: { pageSize: 5 },
      latestVersionOnly: true,
      searchStatement: {
        criteria: { field: "_fullpath", value: p.toLowerCase(), criteriaType: "EXACT" },
      },
    });
    const r = page.results[0];
    if (r) stragglerIds.set(norm(r.itemId), p);
    else console.log(`  ? ${p}: not found`);
  }
  console.log(`Resolved ${stragglerIds.size} straggler itemIds`);

  // Broad scan: any field anywhere referencing one of these.
  console.log("\nScanning /sitecore for refs to stragglers…");
  const { scanned, fieldsByItemId } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore",
    logger: { verbose: (m) => process.stderr.write(`V: ${m}\n`), warn: () => {} } as any,
    options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 50000, includeSystem: true },
    latestVersionOnly: true,
  });
  console.log(`scanned ${scanned.length} items`);

  const re = /\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?/gi;
  const hitsByStraggler = new Map<string, Array<{ srcPath: string; fieldName: string; value: string }>>();
  for (const s of scanned) {
    if (stragglerIds.has(norm(s.itemId))) continue; // skip self
    const fields = fieldsByItemId.get(s.itemId);
    if (!fields) continue;
    for (const f of fields) {
      if (!f.value) continue;
      re.lastIndex = 0;
      const hits = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.value))) {
        const id = norm(m[1] + m[2] + m[3] + m[4] + m[5]);
        if (stragglerIds.has(id)) hits.add(id);
      }
      for (const h of hits) {
        if (!hitsByStraggler.has(h)) hitsByStraggler.set(h, []);
        hitsByStraggler.get(h)!.push({ srcPath: s.path, fieldName: f.name, value: f.value.slice(0, 200) });
      }
    }
  }

  console.log("\n=== Stragglers with their incoming refs ===");
  for (const [id, path] of stragglerIds) {
    const hits = hitsByStraggler.get(id) ?? [];
    console.log(`\n${path} (${id}): ${hits.length} hit(s)`);
    for (const h of hits) {
      console.log(`  ← ${h.srcPath}.${h.fieldName}`);
      console.log(`     value: ${h.value}`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
