import { resolveTenant } from "@/hygiene/tasks/shared";
import { runHygieneAuthoringGraphQL } from "@/hygiene/api/graphql";

const COMPONENT_FOLDERS_ID = "93408df5e2624b8b924849054035ca39";
const DEMO_REGISTRY_TEMPLATES_ID = "71b265dad67e41f6bec4d981ca34cb49";

const main = async () => {
  const { environment } = resolveTenant({ environmentName: "test" });
  const result = await runHygieneAuthoringGraphQL<any>(
    environment,
    `mutation Move($input: MoveItemInput!) {
      moveItem(input: $input) { item { itemId path } }
    }`,
    {
      input: {
        itemId: COMPONENT_FOLDERS_ID,
        targetParentId: DEMO_REGISTRY_TEMPLATES_ID,
      },
    }
  );
  console.log(JSON.stringify(result, null, 2));
};

main().catch((err) => console.error(err?.stack ?? err));
