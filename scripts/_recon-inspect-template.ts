import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const path = process.argv[3] ?? "";
  if (!path) {
    console.log("usage: <env> <path>");
    return;
  }
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const client = createAuthoringClient({ environment });
  const item = await client.getItem({ path });
  if (!item) {
    console.log(`NOT FOUND ${path}`);
    return;
  }
  console.log(`Item: ${item.path} (id=${item.itemId})`);
  console.log(`Template: ${item.templateId}`);
  console.log(`\nFields (${item.fields.length}):`);
  for (const f of item.fields) {
    const v = f.value.length > 80 ? `${f.value.substring(0, 80)}...` : f.value;
    console.log(`  - ${f.name} (${f.fieldId}): ${v}`);
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
