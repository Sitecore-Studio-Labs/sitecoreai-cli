import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

const TARGET_TEMPLATE_NAMES = new Set([
  "badge-block Data Folder",
  "avatar-block Data Folder",
  "card-block Data Folder",
  "cta-button Data Folder",
  "rich-text-block Data Folder",
  "accordion-block Data Folder",
]);

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });
  const { scanned } = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore/templates/Project/ui",
    logger: { verbose: () => {}, warn: () => {} } as any,
    options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
    latestVersionOnly: true,
    skipFields: true,
  });

  console.log("All items in /sitecore/templates/Project/ui:");
  for (const s of scanned.sort((a, b) => a.path.localeCompare(b.path))) {
    const mark = TARGET_TEMPLATE_NAMES.has(s.name) ? "  ← MOVE" : "";
    console.log(`  ${s.itemId}  ${s.path}  (template: ${s.templateName})${mark}`);
  }

  console.log("\nCurrent demo-registry templates structure (top 2 levels):");
  const demo = await client.getChildren({ path: "/sitecore/templates/Project/demo-registry" });
  for (const d of demo) {
    console.log(`  ${d.path}  (template: ${(d as any).templateName ?? "?"})`);
  }
};

main().catch((err) => console.error(err?.stack ?? err));
