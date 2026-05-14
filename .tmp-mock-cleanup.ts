import { resolveTenant } from "@/hygiene/tasks/shared";

// SXA Design Library mock items blocking template deletion.
const MOCK_PATHS = [
  "/sitecore/system/settings/foundation/design library/data sources/mock-article card-ae2a6319-1ec1-43d0-817a-8b7563890a15",
  "/sitecore/system/settings/foundation/design library/data sources/mock-articles-a0da0de7-d40b-4b9a-9232-22650f22d1b7",
  "/sitecore/system/settings/foundation/design library/data sources/mock-badge-bd51f61d-4c6f-4a8b-bb74-76d3ddd7a0c5",
  "/sitecore/system/settings/foundation/design library/data sources/mock-offers-427aada3-d024-4243-be07-cd8e3d8d58c7",
  "/sitecore/system/settings/foundation/design library/data sources/mock-image-ed30e864-ded4-418b-8d7b-9f2292f59426",
  "/sitecore/system/settings/foundation/design library/data sources/mock-offer card-dda8afb8-b1e2-4fa2-99c9-94c6490d6b53",
];

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const lookupItemId = async (client: any, path: string): Promise<string | null> => {
  const page = await client.search({
    paging: { pageSize: 5 },
    latestVersionOnly: true,
    searchStatement: {
      criteria: { field: "_fullpath", value: path.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  return page.results[0]?.itemId ?? null;
};

const TARGETS_AFTER_MOCKS = [
  { name: "Article Card", path: "/sitecore/templates/Project/demo-registry/Article Card" },
  { name: "Articles", path: "/sitecore/templates/Project/demo-registry/Articles" },
  { name: "Badge", path: "/sitecore/templates/Project/demo-registry/Badge" },
  { name: "Offers", path: "/sitecore/templates/Project/demo-registry/Offers" },
  { name: "Image (demo-registry)", path: "/sitecore/templates/Project/demo-registry/Image" },
  { name: "Offer Card", path: "/sitecore/templates/Project/demo-registry/Offer Card" },
  { name: "Page Folder (example)", path: "/sitecore/templates/Project/example/Page Folder" },
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });

  // Phase 1: delete the 6 mock items.
  console.log("=== Phase 1: delete SXA Design Library mocks ===");
  for (const p of MOCK_PATHS) {
    try {
      const id = await lookupItemId(client, p);
      if (!id) {
        console.log(`  ? ${p}: not found`);
        continue;
      }
      await client.deleteItem({ itemId: norm(id), permanently: true });
      console.log(`  ✓ ${p.split("/").pop()}`);
    } catch (err: any) {
      console.log(`  ✗ ${p.split("/").pop()}: ${String(err?.message ?? err).slice(0, 100)}`);
    }
  }

  // Phase 2: retry deleting the unblocked templates (with poll-retry for index lag).
  console.log("\n=== Phase 2: retry deletes (with index-lag poll) ===");
  const pending = new Map<string, string>(); // path -> itemId
  for (const t of TARGETS_AFTER_MOCKS) {
    const id = await lookupItemId(client, t.path);
    if (id) pending.set(t.path, norm(id));
  }

  for (let attempt = 1; attempt <= 8 && pending.size > 0; attempt++) {
    if (attempt > 1) await sleep(15000);
    console.log(`\nAttempt ${attempt} (${pending.size} remaining):`);
    for (const [path, id] of [...pending]) {
      try {
        await client.deleteItem({ itemId: id, permanently: true });
        pending.delete(path);
        console.log(`  ✓ ${path.split("/").pop()}`);
      } catch (err: any) {
        console.log(`  ✗ ${path.split("/").pop()}: ${String(err?.message ?? err).slice(0, 80)}`);
      }
    }
  }

  console.log(`\n${pending.size === 0 ? "All cleared ✓" : `${pending.size} still failing — see above for details`}`);
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
