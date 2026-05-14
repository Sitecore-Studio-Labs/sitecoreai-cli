import { resolveTenant } from "@/hygiene/tasks/shared";
import { runHygieneAuthoringGraphQL } from "@/hygiene/api/graphql";

const TARGETS = [
  { name: "Badge", id: "cd7d3774e1ab42a9b5325e5e0012ed10", path: "/sitecore/templates/Project/demo-registry/Badge" },
  { name: "Page Folder (example)", id: "5021d6921afe4d98b037a5a1f9bec808", path: "/sitecore/templates/Project/example/Page Folder" },
];

const main = async () => {
  const { client, environment } = resolveTenant({ environmentName: "test" });

  for (const t of TARGETS) {
    console.log(`\n=== ${t.name} (${t.id}) ===`);

    // 1) Search with latestVersionOnly = false (old versions count too).
    try {
      const all = await client.search({
        paging: { pageSize: 100 },
        latestVersionOnly: false,
        searchStatement: {
          criteria: { field: "_template", value: t.id, criteriaType: "EXACT" },
        },
      });
      console.log(`  _template=ID (all versions): ${all.totalCount} hits`);
      for (const r of all.results.slice(0, 20)) {
        console.log(`    v${r.version} (${r.language?.name}): ${r.path}`);
      }
    } catch (err: any) {
      console.log(`  ERR (latestVersionOnly=false): ${String(err?.message ?? err).slice(0, 100)}`);
    }

    // 2) Inspect the template itself for its __Base templates value.
    try {
      const fields = await client.getItemFields({ itemId: t.id });
      const baseTpls = fields?.find((f) => f.name === "__Base templates");
      console.log(`  This template's __Base templates: ${baseTpls?.value ?? "(none)"}`);
    } catch {}

    // 3) Look up the item via Authoring GraphQL `item.children` if it has any.
    try {
      const result = await runHygieneAuthoringGraphQL<any>(
        environment,
        `query($id: ID!) {
          item(where: { itemId: $id }) {
            itemId
            name
            path
            template { name templateId }
            hasChildren
            children(first: 50) { nodes { itemId name path template { name } } }
          }
        }`,
        { id: t.id }
      );
      console.log(`  Authoring API item.children: hasChildren=${result?.item?.hasChildren}`);
      const kids = result?.item?.children?.nodes ?? [];
      for (const k of kids) console.log(`    child: ${k.path}  (${k.template?.name})`);
    } catch (err: any) {
      console.log(`  ERR (item.children): ${String(err?.message ?? err).slice(0, 100)}`);
    }

    // 4) Archived items (recycle bin) — anything with original template == target?
    try {
      const arch = await client.listArchivedItems({ pageSize: 100 });
      const hits = arch.filter((a: any) => a.parentId === t.id || a.itemId === t.id);
      console.log(`  Archive: ${hits.length} hits referencing target id`);
      for (const h of hits.slice(0, 5)) console.log(`    archived: ${h.name}  ${h.originalLocation}`);
    } catch (err: any) {
      console.log(`  ERR (archive): ${String(err?.message ?? err).slice(0, 100)}`);
    }
  }
};

main().catch((err) => console.error(err?.stack ?? err));
