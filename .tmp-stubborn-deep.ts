import { resolveTenant } from "@/hygiene/tasks/shared";
import { runHygieneAuthoringGraphQL } from "@/hygiene/api/graphql";

const TARGETS = [
  { name: "Badge", id: "cd7d3774e1ab42a9b5325e5e0012ed10" },
  { name: "Page Folder (example)", id: "5021d6921afe4d98b037a5a1f9bec808" },
];

const main = async () => {
  const { environment } = resolveTenant({ environmentName: "test" });

  // Introspect ItemTemplate.standardValuesItem field args.
  const intro = await runHygieneAuthoringGraphQL<any>(
    environment,
    `query { __type(name: "ItemTemplate") { fields { name args { name type { name kind ofType { name kind } } } } } }`,
    {}
  );
  for (const f of intro?.__type?.fields ?? []) {
    if (f.args?.length) console.log(`.${f.name}(${(f.args ?? []).map((a: any) => `${a.name}: ${a.type?.name ?? a.type?.ofType?.name ?? a.type?.kind}`).join(", ")})`);
  }
  console.log("---");

  for (const t of TARGETS) {
    try {
      const result = await runHygieneAuthoringGraphQL<any>(
        environment,
        `query($id: ID!) {
          itemTemplate(where: { templateId: $id }) {
            name
            fullName
            templateId
            standardValuesItem(language: "en") { itemId path name template { name } }
          }
        }`,
        { id: t.id }
      );
      console.log(`${t.name}:`, JSON.stringify(result, null, 2));
    } catch (err: any) {
      console.log(`${t.name} ERR: ${String(err?.message ?? err).slice(0, 200)}`);
    }
  }
};

main().catch((err) => console.error(err?.stack ?? err));
