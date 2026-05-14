import { resolveTenant } from "@/hygiene/tasks/shared";

const TARGETS = [
  { name: "Badge", id: "cd7d3774e1ab42a9b5325e5e0012ed10" },
  { name: "Page Folder (example)", id: "5021d6921afe4d98b037a5a1f9bec808" },
];

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });
  for (const t of TARGETS) {
    console.log(`\n=== ${t.name} (${t.id}) ===`);
    const byTemplate = await client.search({
      paging: { pageSize: 50 },
      latestVersionOnly: true,
      searchStatement: {
        criteria: { field: "_template", value: t.id, criteriaType: "EXACT" },
      },
    });
    console.log(`  _template=ID: ${byTemplate.totalCount} hits`);
    for (const r of byTemplate.results.slice(0, 50)) console.log(`    ${r.path}`);
  }
};

main().catch((err) => console.error(err?.stack ?? err));
