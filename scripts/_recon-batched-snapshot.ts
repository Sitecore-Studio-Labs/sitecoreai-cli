/**
 * Recon: exercise the batched snapshot-read methods against a live
 * tenant. Confirms the aliased GraphQL queries produced by
 * `getItemPerLanguageBatch` and `getItemAtVersionsBatch` are syntactically
 * accepted and return sensible data.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-batched-snapshot.ts [envName] [itemId]
 */
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "@/recipe/api/authoring-client";
import { STANDARD_TEMPLATE_ID } from "@/recipe/ir/sitecore-templates";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const itemId = process.argv[3] ?? STANDARD_TEMPLATE_ID;
  const { environment, timeoutMs } = resolveEnvironment({
    environmentName: envName,
    skipPolicy: true,
  });
  const client = createAuthoringClient({ environment, request: { timeoutMs } });

  const tenantLangs = await client.getTenantLanguages();
  console.log(`[recon] tenant languages on '${envName}': ${JSON.stringify(tenantLangs)}\n`);

  console.log(
    `[recon] getItemPerLanguageBatch(${itemId}, ${JSON.stringify(tenantLangs.slice(0, 3))})`
  );
  const perLang = await client.getItemPerLanguageBatch({ itemId }, tenantLangs.slice(0, 3));
  for (const entry of perLang) {
    console.log(
      `  - ${entry.language}: versions=[${entry.versions.join(",")}] item=${entry.item ? `'${entry.item.name}' fieldCount=${entry.item.fields.length}` : "null"}`
    );
  }

  // Pick versions to fetch via the second batched call. For the
  // standard template (which typically has only v1 in en) there's
  // nothing historic — but the call shape itself is the assertion.
  const historic = perLang.flatMap((e) =>
    e.versions.slice(0, -1).map((v) => ({ language: e.language, version: v }))
  );
  console.log(`\n[recon] getItemAtVersionsBatch(${itemId}, ${JSON.stringify(historic)})`);
  const atVersions = await client.getItemAtVersionsBatch({ itemId }, historic);
  console.log(`  results: ${atVersions.map((r) => (r ? `'${r.name}'` : "null")).join(", ")}`);

  // Empty-input degenerate guards.
  console.log("\n[recon] empty-input guards");
  const emptyLang = await client.getItemPerLanguageBatch({ itemId }, []);
  const emptyVer = await client.getItemAtVersionsBatch({ itemId }, []);
  console.log(`  perLanguage([]) = ${JSON.stringify(emptyLang)}`);
  console.log(`  atVersions([])  = ${JSON.stringify(emptyVer)}`);

  // Force-exercise the historic-versions aliased query shape with a
  // synthetic request that should return [null] when the item doesn't
  // have a v2. Confirms the GraphQL query parses and runs even though
  // the result is empty.
  console.log("\n[recon] forced historic-versions probe (item, en, v2 — likely null)");
  const forcedVer = await client.getItemAtVersionsBatch({ itemId }, [
    { language: "en", version: 2 },
  ]);
  console.log(`  result: ${forcedVer.map((r) => (r ? `'${r.name}'` : "null")).join(", ")}`);
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
