import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

// External-ref fixes. Each entry specifies the source item, the field to
// update, and a transform applied to the existing value.
type Fix = {
  label: string;
  path: string;
  fieldName: string;
  transform: "clear" | { stripGuids: string[] };
};

const FIXES: Fix[] = [
  // Active-content __Masters: strip the Button Data Folder ref but keep the other.
  {
    label: "test-sync data/button __Masters",
    path: "/sitecore/content/example/test-sync/data/button",
    fieldName: "__Masters",
    transform: { stripGuids: ["d86791d80991410fbcd90ef2c01ebc51"] },
  },
  {
    label: "content-modelling data/button __Masters",
    path: "/sitecore/content/demo-registry/content-modelling/data/button",
    fieldName: "__Masters",
    transform: { stripGuids: ["d86791d80991410fbcd90ef2c01ebc51"] },
  },
  // Moved component folders / accordion-block folder __standard values __Masters: clear.
  {
    label: "accordion-block folder __standard values __Masters",
    path: "/sitecore/templates/Project/demo-registry/Component Folders/accordion-block folder/__Standard Values",
    fieldName: "__Masters",
    transform: "clear",
  },
  // SXA scaffolding actions — clear Template field on each (no-op the action).
  {
    label: "feature/JSS Experience Accelerator/Add Buttons Data Item",
    path: "/sitecore/system/Settings/Feature/JSS Experience Accelerator/Page Content/Headless Page Content Site Setup/Add Buttons Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  // Demo-registry tenant-level scaffolding actions (parent has a trailing space in name).
  {
    label: "demo-registry/Add Cards Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Cards Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  {
    label: "demo-registry/Add Badges Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Badges Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  {
    label: "demo-registry/Add Richtexts Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Richtexts Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  {
    label: "demo-registry/Add Images Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Images Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  {
    label: "demo-registry/Add Articles Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Articles Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  {
    label: "demo-registry/Add Article Cards Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Article Cards Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  {
    label: "demo-registry/Add Offer Cards Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Offer Cards Data Item",
    fieldName: "Template",
    transform: "clear",
  },
  {
    label: "demo-registry/Add Offers Data Item",
    path: "/sitecore/system/Settings/Project/demo-registry/demo-registry /Add Offers Data Item",
    fieldName: "Template",
    transform: "clear",
  },
];

// Blocker roots — will bottom-up delete after fixes.
const BLOCKERS = [
  "/sitecore/templates/Project/demo-registry/Datasources",
  "/sitecore/templates/Project/demo-registry/Article Card",
  "/sitecore/templates/Project/demo-registry/Articles",
  "/sitecore/templates/Project/demo-registry/Badge",
  "/sitecore/templates/Project/demo-registry/Offer Card_2",
  "/sitecore/templates/Project/demo-registry/Offers",
  "/sitecore/templates/Project/demo-registry/Image",
  "/sitecore/templates/Project/demo-registry/Article Card Folder",
  "/sitecore/templates/Project/demo-registry/Articles Folder",
  "/sitecore/templates/Project/demo-registry/Badge Folder",
  "/sitecore/templates/Project/demo-registry/Image Folder",
  "/sitecore/templates/Project/demo-registry/Offer Card Folder",
  "/sitecore/templates/Project/demo-registry/Offers Folder",
  "/sitecore/templates/Project/demo-registry/Headless Tenant",
  "/sitecore/templates/Project/demo-registry/Offer Card",
  "/sitecore/templates/Project/example/Headless Tenant",
  "/sitecore/templates/Project/example/Page Folder",
  "/sitecore/templates/Project/accordion-item",
  "/sitecore/templates/Project/CtaButton",
  "/sitecore/templates/Project/CtaButton Parameters",
  "/sitecore/templates/Project/Presentation",
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Look up itemIds by path via search (_fullpath EXACT).
  const lookupItemId = async (path: string): Promise<string | null> => {
    const page = await client.search({
      paging: { pageSize: 5 },
      latestVersionOnly: true,
      searchStatement: {
        criteria: { field: "_fullpath", value: path.toLowerCase(), criteriaType: "EXACT" },
      },
    });
    return page.results[0]?.itemId ?? null;
  };

  // ===== Phase 1: apply external-ref fixes =====
  console.log("=== Phase 1: clearing external refs ===");
  for (const fix of FIXES) {
    try {
      const itemId = await lookupItemId(fix.path);
      if (!itemId) {
        console.log(`  ? ${fix.label}: item not found at path, skipping`);
        continue;
      }
      const fields = await client.getItemFields({ itemId });
      if (!fields) {
        console.log(`  ? ${fix.label}: fields not found for itemId ${itemId}`);
        continue;
      }
      const f = fields.find((x) => x.name === fix.fieldName);
      const current = f?.value ?? "";
      let next: string;
      if (fix.transform === "clear") {
        next = "";
      } else {
        const pieces = current.split("|");
        const kept: string[] = [];
        for (const p of pieces) {
          const m = p.match(
            /\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?/i
          );
          if (m) {
            const id = norm(m[1] + m[2] + m[3] + m[4] + m[5]);
            if (fix.transform.stripGuids.includes(id)) continue;
          }
          kept.push(p);
        }
        next = kept.join("|");
      }
      if (next === current) {
        console.log(`  · ${fix.label}: already clean (current="${current.slice(0, 40)}")`);
        continue;
      }
      await client.updateItemFields({
        itemId,
        fields: [{ name: fix.fieldName, value: next }],
      });
      console.log(`  ✓ ${fix.label}: "${current.slice(0, 40)}" → "${next.slice(0, 40)}"`);
    } catch (err: any) {
      console.log(`  ✗ ${fix.label}: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }

  // ===== Phase 2: bottom-up delete each blocker subtree, with retry =====
  console.log("\n=== Phase 2: bottom-up delete of blocker subtrees ===");
  for (const blockerPath of BLOCKERS) {
    let scanned: any[];
    try {
      const s = await scanItemsAndFields({
        client,
        envName,
        root: blockerPath,
        logger: { verbose: () => {}, warn: () => {} } as any,
        options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
        latestVersionOnly: true,
        skipFields: true,
      });
      scanned = s.scanned;
    } catch (err: any) {
      console.log(`  ⚠ ${blockerPath}: scan failed (${err?.message ?? err})`);
      continue;
    }
    if (scanned.length === 0) {
      console.log(`  · ${blockerPath}: already empty`);
      continue;
    }
    const sorted = [...scanned].sort((a, b) => b.path.split("/").length - a.path.split("/").length);

    // Loop deletes with up to 5 retries per item (in case of index lag).
    const pending = new Map<string, string>(sorted.map((s) => [s.itemId, s.path]));
    for (let attempt = 1; attempt <= 5 && pending.size > 0; attempt++) {
      if (attempt > 1) await sleep(10000);
      for (const [id, path] of [...pending]) {
        try {
          await client.deleteItem({ itemId: id, permanently: true });
          pending.delete(id);
        } catch {
          // try again on next attempt
        }
      }
    }
    const okCount = scanned.length - pending.size;
    if (pending.size === 0) {
      console.log(`  ✓ ${blockerPath}: all ${scanned.length} items deleted`);
    } else {
      console.log(`  ✗ ${blockerPath}: ${okCount}/${scanned.length} deleted; ${pending.size} stragglers`);
      for (const path of pending.values()) console.log(`      still blocking: ${path}`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
