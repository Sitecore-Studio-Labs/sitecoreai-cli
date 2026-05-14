import { resolveTenant } from "@/hygiene/tasks/shared";

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });
  const kids = await client.getChildren({ itemId: "29b28db28cca45aa893d4f549f0c5d32" });
  for (const k of kids) {
    console.log(`${k.path}  (template: ${(k as any).templateName ?? "?"})`);
    const grand = await client.getChildren({ itemId: k.itemId });
    for (const g of grand)
      console.log(`  ${g.path}  (template: ${(g as any).templateName ?? "?"})`);
  }
};

main().catch((e) => console.error(e));
