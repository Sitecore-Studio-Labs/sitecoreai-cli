import {
  resolveTenant,
  scanItemsAndFields,
  extractInternalRefs,
} from "@/hygiene/tasks/shared";

const ACTIVE_CONTENT_ROOTS = [
  "/sitecore/content/example/test-sync",
  "/sitecore/content/demo-registry/content-modelling",
];

// The 26 candidates flagged as "no inbound refs" by cleanup site-residue.
// Plus the 2 stubborn templates we couldn't delete earlier.
const CANDIDATES = [
  { name: "Rendering Parameters", path: "/sitecore/templates/Project/demo-registry/Rendering Parameters" },
  { name: "Video", path: "/sitecore/templates/Project/demo-registry/Video" },
  { name: "Component Folders", path: "/sitecore/templates/Project/demo-registry/Component Folders" },
  { name: "TextBlockTplP4divlkrx", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4divlkrx" },
  { name: "TextBlockTplP4foq11", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4foq11" },
  { name: "TextBlockTplP4lantj3", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4lantj3" },
  { name: "TextBlockTplP4mom2hq1h2sy", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4mom2hq1h2sy" },
  { name: "TextBlockTplP4mom2wopo0dg", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4mom2wopo0dg" },
  { name: "TextBlockTplP4mom31e2r0m8", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4mom31e2r0m8" },
  { name: "TextBlockTplP4momnqt8p3ex", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4momnqt8p3ex" },
  { name: "TextBlockTplP4momntiy55rx", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4momntiy55rx" },
  { name: "TextBlockTplP4rmom2cxew", path: "/sitecore/templates/Project/demo-registry/TextBlockTplP4rmom2cxew" },
  { name: "Video Folder", path: "/sitecore/templates/Project/demo-registry/Video Folder" },
  { name: "Badge", path: "/sitecore/templates/Project/demo-registry/Badge" },
  { name: "RecipeTestContentTplmolzpyuh7oj", path: "/sitecore/templates/Project/demo-registry/RecipeTestContentTplmolzpyuh7oj" },
  { name: "RecipeTestPageTplmolzpyuh7oj", path: "/sitecore/templates/Project/demo-registry/RecipeTestPageTplmolzpyuh7oj" },
  { name: "Page Folder (example)", path: "/sitecore/templates/Project/example/Page Folder" },
];

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Build templateIds-in-use set from active content.
  console.log("=== Building active-content templateId set ===");
  const activeTemplateIds = new Set<string>();
  for (const root of ACTIVE_CONTENT_ROOTS) {
    const { scanned } = await scanItemsAndFields({
      client,
      envName,
      root,
      logger: { verbose: () => {}, warn: () => {} } as any,
      options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 10000 },
      latestVersionOnly: true,
      skipFields: true,
    });
    for (const s of scanned) {
      if (s.templateId) activeTemplateIds.add(norm(s.templateId));
    }
  }
  console.log(`  ${activeTemplateIds.size} distinct templateIds in use by active content`);

  // Pre-build a field-index of all active content (templateId-only, fields not needed since site-residue already did the ref scan).

  // For each candidate, gather subtree itemIds and check if any are derived from by active content.
  console.log("\n=== Safety check per candidate ===");
  const safe: Array<{ name: string; path: string; subtreeIds: Set<string> }> = [];
  const blocked: Array<{ name: string; conflicts: string[] }> = [];
  for (const c of CANDIDATES) {
    try {
      const { scanned } = await scanItemsAndFields({
        client,
        envName,
        root: c.path,
        logger: { verbose: () => {}, warn: () => {} } as any,
        options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
        latestVersionOnly: true,
        skipFields: true,
      });
      const ids = new Set(scanned.map((s) => norm(s.itemId)));
      const conflicts: string[] = [];
      for (const id of ids) {
        if (activeTemplateIds.has(id)) conflicts.push(id);
      }
      if (conflicts.length === 0) {
        safe.push({ name: c.name, path: c.path, subtreeIds: ids });
        console.log(`  ✓ ${c.name} (${ids.size} items): no active deriver`);
      } else {
        blocked.push({ name: c.name, conflicts });
        console.log(`  ✗ ${c.name} (${ids.size}): ${conflicts.length} active content items derive from this subtree`);
      }
    } catch (err: any) {
      console.log(`  ⚠ ${c.name}: scan failed (${err?.message ?? err})`);
    }
  }

  console.log(`\n${safe.length} safe to delete, ${blocked.length} blocked by templateId derivation`);

  // Execute bottom-up deletes with retry (handle index lag).
  console.log("\n=== Executing deletes (bottom-up per candidate, retry on lag) ===");
  for (const c of safe) {
    // Re-scan to get fresh subtree + paths for sort.
    const { scanned } = await scanItemsAndFields({
      client,
      envName,
      root: c.path,
      logger: { verbose: () => {}, warn: () => {} } as any,
      options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
      latestVersionOnly: true,
      skipFields: true,
    });
    const sorted = [...scanned].sort((a, b) => b.path.split("/").length - a.path.split("/").length);
    const pending = new Map<string, string>(sorted.map((s) => [norm(s.itemId), s.path]));
    for (let attempt = 1; attempt <= 6 && pending.size > 0; attempt++) {
      if (attempt > 1) await sleep(15000);
      for (const [id, path] of [...pending]) {
        try {
          await client.deleteItem({ itemId: id, permanently: true });
          pending.delete(id);
        } catch {}
      }
    }
    const okCount = scanned.length - pending.size;
    if (pending.size === 0) {
      console.log(`  ✓ ${c.name}: all ${scanned.length} items deleted`);
    } else {
      console.log(`  ⚠ ${c.name}: ${okCount}/${scanned.length}; ${pending.size} stragglers (${[...pending.values()].join(", ").slice(0, 100)})`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
