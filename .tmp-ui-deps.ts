import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Collect every itemId under /sitecore/templates/Project/ui — these are
  // the templates the safety check flagged as "in use".
  const uiSubtree = await scanItemsAndFields({
    client,
    envName,
    root: "/sitecore/templates/Project/ui",
    logger: { verbose: () => {}, warn: () => {} } as any,
    options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
    latestVersionOnly: true,
    skipFields: true,
  });
  const uiTemplateIds = new Set(uiSubtree.scanned.map((s) => norm(s.itemId)));
  console.log(`/sitecore/templates/Project/ui has ${uiTemplateIds.size} items`);

  // Walk both active-content roots; find items whose templateId is in uiTemplateIds.
  const ACTIVE = [
    "/sitecore/content/example/test-sync",
    "/sitecore/content/demo-registry/content-modelling",
  ];
  for (const root of ACTIVE) {
    const { scanned } = await scanItemsAndFields({
      client,
      envName,
      root,
      logger: { verbose: () => {}, warn: () => {} } as any,
      options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 10000 },
      latestVersionOnly: true,
      skipFields: true,
    });
    console.log(`\n--- ${root} (${scanned.length} items) ---`);
    let hits = 0;
    for (const s of scanned) {
      if (!s.templateId) continue;
      if (uiTemplateIds.has(norm(s.templateId))) {
        hits += 1;
        console.log(`  ${s.path}  template=${s.templateName}  (templateId in ui subtree)`);
      }
    }
    if (hits === 0) console.log("  (no hits)");
  }
};

main().catch((err) => console.error(err?.stack ?? err));
