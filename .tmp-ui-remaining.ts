import { resolveTenant, scanItemsAndFields } from "@/hygiene/tasks/shared";

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
  for (const s of scanned.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`${s.itemId}  ${s.path}  (${s.templateName})`);
  }
  console.log(`\nTotal: ${scanned.length}`);

  // For each of the 6 component templates, search for any item using its templateId.
  console.log("\n=== Finding items derived from each remaining template ===");
  const checkIds = [
    { name: "accordion-block", id: "4d57c4f12f87460190ce895dcfe8b519" },
    { name: "avatar-block", id: "f29336deeff4485ba0393d8cd6ad61a7" },
    { name: "badge-block", id: "e5af3a777c6745b3812783ad3e8957d5" },
    { name: "card-block", id: "d6ccc20205144697a31cb5bfb1a36c69" },
    { name: "cta-button", id: "d5045f52e27645c09d396fc48fc879d0" },
    { name: "rich-text-block", id: "6ac5404af99c49d69e40513219704d37" },
  ];
  for (const { name, id } of checkIds) {
    // Search by templateId across the whole tenant
    const page = await client.search({
      paging: { pageSize: 50 },
      latestVersionOnly: true,
      searchStatement: {
        criteria: { field: "_template", value: id, criteriaType: "EXACT" },
      },
    });
    console.log(`\n${name} (${id}): ${page.totalCount} items derive from this template`);
    for (const r of page.results.slice(0, 10)) console.log(`  ${r.path}`);
    if (page.totalCount > page.results.length) console.log(`  …and ${page.totalCount - page.results.length} more`);
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
