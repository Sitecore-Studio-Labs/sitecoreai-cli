/**
 * Recon: verify `AuthoringApiClient.getItemVersions` against a live tenant —
 * a read-only check that the `item(where:{itemId,language}){versions{version}}`
 * query shape is correct before the executor depends on it.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-item-versions.ts [envName] [itemId]
 */
import { resolveEnvironment } from "@/shared/env";
import { createAuthoringClient } from "@/recipe/api/authoring-client";
import { STANDARD_TEMPLATE_ID } from "@/recipe/ir/sitecore-templates";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "test";
  const itemId = process.argv[3] ?? STANDARD_TEMPLATE_ID;
  const { environment, timeoutMs } = resolveEnvironment({ environmentName: envName });
  const client = createAuthoringClient({ environment, request: { timeoutMs } });

  const versions = await client.getItemVersions({ itemId }, "en");
  console.log(`[recon] getItemVersions(${itemId}, "en") -> [${versions.join(", ")}]`);
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
