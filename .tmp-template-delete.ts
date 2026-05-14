import { resolveTenant } from "@/hygiene/tasks/shared";
import { runHygieneAuthoringGraphQL } from "@/hygiene/api/graphql";

const TARGETS = [
  { name: "Badge", id: "cd7d3774e1ab42a9b5325e5e0012ed10" },
  { name: "Page Folder (example)", id: "5021d6921afe4d98b037a5a1f9bec808" },
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {
  const { client, environment } = resolveTenant({ environmentName: "test" });

  // Attempt 1: deleteItemTemplate (template-specific) instead of deleteItem.
  console.log("=== Attempt: deleteItemTemplate ===");
  for (const t of TARGETS) {
    try {
      await client.deleteItemTemplate(t.id);
      console.log(`  ✓ ${t.name} via deleteItemTemplate`);
    } catch (err: any) {
      console.log(`  ✗ ${t.name}: ${String(err?.message ?? err).slice(0, 150)}`);
    }
  }

  // Attempt 2: archive (non-permanent delete). Sitecore sometimes allows archive
  // when full delete is blocked — and once archived we can purge from the archive.
  console.log("\n=== Attempt: archive (permanently: false) ===");
  for (const t of TARGETS) {
    try {
      await client.deleteItem({ itemId: t.id, permanently: false });
      console.log(`  ✓ ${t.name} archived`);
    } catch (err: any) {
      console.log(`  ✗ ${t.name}: ${String(err?.message ?? err).slice(0, 150)}`);
    }
  }

  // Attempt 3: wait longer, retry permanent delete (in case it's just delayed cache invalidation).
  console.log("\n=== Attempt: long wait + permanent delete ===");
  await sleep(120000); // 2 min
  for (const t of TARGETS) {
    try {
      await client.deleteItem({ itemId: t.id, permanently: true });
      console.log(`  ✓ ${t.name} after long wait`);
    } catch (err: any) {
      console.log(`  ✗ ${t.name}: ${String(err?.message ?? err).slice(0, 150)}`);
    }
  }
};

main().catch((err) => console.error(err?.stack ?? err));
