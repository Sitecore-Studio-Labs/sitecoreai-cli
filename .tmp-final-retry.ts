import { resolveTenant } from "@/hygiene/tasks/shared";

// 5 remaining straggler templates after the safety-checked cleanup pass.
const TARGETS = [
  { name: "Rendering Parameters", path: "/sitecore/templates/Project/demo-registry/Rendering Parameters" },
  { name: "Video", path: "/sitecore/templates/Project/demo-registry/Video" },
  { name: "Video Folder", path: "/sitecore/templates/Project/demo-registry/Video Folder" },
  { name: "Badge", path: "/sitecore/templates/Project/demo-registry/Badge" },
  { name: "Page Folder (example)", path: "/sitecore/templates/Project/example/Page Folder" },
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });
  const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

  // Initial pre-flight: confirm each still exists. Skip any that quietly cleared.
  const pending = new Map<string, { name: string; path: string }>();
  for (const t of TARGETS) {
    const id = await lookupItemId(client, t.path);
    if (id) pending.set(norm(id), t);
    else console.log(`  · ${t.name}: already gone`);
  }

  // Two long-wait retries spaced 90s apart. Sitecore's stale "is-used" cache
  // typically clears on the next index refresh; 90s is the slowest the
  // platform should need under normal conditions.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (pending.size === 0) break;
    if (attempt > 1) {
      console.log(`\n[wait 90s for indexer]`);
      await sleep(90000);
    }
    console.log(`\nAttempt ${attempt} (${pending.size} remaining):`);
    for (const [id, t] of [...pending]) {
      try {
        await client.deleteItem({ itemId: id, permanently: true });
        pending.delete(id);
        console.log(`  ✓ ${t.name}`);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        console.log(`  ✗ ${t.name}: ${msg.slice(0, 90)}`);
      }
    }
  }

  console.log(`\n${pending.size === 0 ? "All cleared ✓" : `${pending.size} still stuck — Sitecore-side stale cache`}`);
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
