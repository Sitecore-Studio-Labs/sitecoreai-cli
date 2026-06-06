/**
 * Sub-milestone E debugging + cleanup helper. Inspects what the failed
 * test run left behind on the tenant and deletes it.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-verify-cleanup-e2e.ts [envName] [runId]
 */
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const runId = process.argv[3] ?? "";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const client = createAuthoringClient({ environment });

  const root = "/sitecore/templates/Project/scai-e2e";
  console.log(`Looking under: ${root}`);
  const folder = await client.getItem({ path: root });
  if (!folder) {
    console.log("No scai-e2e folder — nothing to clean.");
    return;
  }
  const children = await client.getChildren({ itemId: folder.itemId });
  console.log(`Found ${children.length} direct children:`);
  for (const c of children) {
    console.log(`  - ${c.name} (${c.itemId}) template=${c.templateId}`);
    if (c.name === "Modules") {
      const modules = await client.getChildren({ itemId: c.itemId });
      for (const m of modules) {
        console.log(`    - module: ${m.name} (${m.itemId})`);
        const subs = await client.getChildren({ itemId: m.itemId });
        for (const s of subs) {
          console.log(`      - ${s.name} (${s.itemId}) template=${s.templateId}`);
        }
      }
    }
  }

  // Look at the just-uploaded media
  const mediaRoot = "/sitecore/media library/SiteTemplates";
  const media = await client.getItem({ path: mediaRoot });
  if (media) {
    const mediaChildren = await client.getChildren({ itemId: media.itemId });
    console.log(`\nMedia library SiteTemplates folder has ${mediaChildren.length} entries:`);
    for (const m of mediaChildren) {
      console.log(`  - ${m.name} (${m.itemId})`);
      if (runId && m.name.includes(runId)) {
        console.log(`    [contains RUN_ID; would clean]`);
      }
    }
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
