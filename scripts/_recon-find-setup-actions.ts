import { resolveEnvironment } from "@/policy/environment";
import { runAuthoringGraphQL } from "@/recipe/api/graphql";

const FIND = `
query {
  AddItem: search(query: { rootItem: "/sitecore/templates", paging: { pageSize: 5 }, where: { name: "name", value: "AddItem", operator: EQ } }) {
    results { itemId path templateName }
  }
  EditSiteItem: search(query: { rootItem: "/sitecore/templates", paging: { pageSize: 5 }, where: { name: "name", value: "EditSiteItem", operator: EQ } }) {
    results { itemId path templateName }
  }
  EditTenantTemplate: search(query: { rootItem: "/sitecore/templates", paging: { pageSize: 5 }, where: { name: "name", value: "EditTenantTemplate", operator: EQ } }) {
    results { itemId path templateName }
  }
}`;

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  try {
    const data = await runAuthoringGraphQL<
      Record<string, { results: Array<{ itemId: string; path: string; templateName: string }> }>
    >(environment, FIND);
    for (const [key, val] of Object.entries(data)) {
      console.log(`\n${key}:`);
      for (const r of val.results) {
        console.log(`  - ${r.path} (${r.itemId}) template=${r.templateName}`);
      }
    }
  } catch (e) {
    console.error("search failed:", e);
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
