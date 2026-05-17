/**
 * Recon: dump every field on the `Scai Handle` Template Field item, so we
 * can read the authoritative GUIDs of the Template Field template's own
 * definition fields (`Read Only`, `Unversioned`, …) off a live tenant
 * rather than hard-coding unverified constants.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-marker-field.ts <envName> [itemId]
 */
import { resolveEnvironment } from "@/shared/env";
import { createAuthoringClient } from "@/recipe/api/authoring-client";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "test";
  const itemId = process.argv[3] ?? "71c7237760db479cb156817a6977f5e5";
  const configPath = process.env.SCAI_CONFIG;
  const { environment, timeoutMs } = resolveEnvironment({
    environmentName: envName,
    ...(configPath ? { config: configPath } : {}),
  });
  const client = createAuthoringClient({ environment, request: { timeoutMs } });

  const item = await client.getItem({ itemId });
  if (!item) {
    process.stderr.write(`item ${itemId} not found on '${envName}'\n`);
    process.exit(1);
  }
  console.log(`item: "${item.name}" (${item.itemId}) template=${item.templateId}`);
  console.log(`fields (${item.fields.length}):`);
  for (const f of [...item.fields].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))) {
    console.log(
      `  ${(f.name ?? "(noname)").padEnd(26)} id=${f.fieldId}  value=${JSON.stringify(f.value)}`
    );
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
