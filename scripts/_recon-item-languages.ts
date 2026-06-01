/**
 * Recon: probe the Authoring API GraphQL schema for `Item.languages` and
 * related shapes — verifies whether the auto-discovery query scai's
 * prune-rollback snapshot path uses is actually supported on a live
 * tenant, and which sub-field carries the ISO code.
 *
 * Tries, in order:
 *   1. item { languages { name } }
 *   2. item { languages { iso } }
 *   3. item { languages }                     (scalar list?)
 *   4. item { languages { language { name } } } (nested?)
 *
 * Plus: probes `versions { language { name } }` and `versions { language }`
 * as a fallback path that doesn't require Item.languages.
 *
 * For each probe, prints either the result or the GraphQL error so we
 * can pick the right query shape for the production client.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-item-languages.ts [envName] [itemId]
 */
import { resolveEnvironment } from "@/policy/environment";
import { runAuthoringGraphQL } from "@/recipe/api/graphql";
import { STANDARD_TEMPLATE_ID } from "@/recipe/ir/sitecore-templates";

const probe = async (
  environment: Parameters<typeof runAuthoringGraphQL>[0],
  label: string,
  query: string,
  variables: Record<string, unknown>
): Promise<void> => {
  try {
    const data = await runAuthoringGraphQL<Record<string, unknown>>(environment, query, variables);
    console.log(`[${label}] OK:`);
    console.log(JSON.stringify(data, null, 2).slice(0, 600));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[${label}] ERROR: ${msg.slice(0, 400)}`);
  }
};

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const itemId = process.argv[3] ?? STANDARD_TEMPLATE_ID;
  // Read-only schema probe — skip the workspace policy gate so envs with
  // identity drift (Agents) and post-rotation envs (RegistryCM) still
  // probe.
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  console.log(`Probing schema on env '${envName}' for itemId ${itemId}\n`);

  await probe(
    environment,
    "languages.name",
    `query($itemId: ID!) { item(where: { itemId: $itemId }) { languages { name } } }`,
    { itemId }
  );
  await probe(
    environment,
    "languages.iso",
    `query($itemId: ID!) { item(where: { itemId: $itemId }) { languages { iso } } }`,
    { itemId }
  );
  await probe(
    environment,
    "languages.displayName",
    `query($itemId: ID!) { item(where: { itemId: $itemId }) { languages { displayName } } }`,
    { itemId }
  );
  await probe(
    environment,
    "languages-scalar",
    `query($itemId: ID!) { item(where: { itemId: $itemId }) { languages } }`,
    { itemId }
  );
  await probe(
    environment,
    "languages.language.name",
    `query($itemId: ID!) { item(where: { itemId: $itemId }) { languages { language { name } } } }`,
    { itemId }
  );

  console.log("\n--- versions-based probes (Item.languages doesn't exist) ---");
  await probe(
    environment,
    "versions.language.name (no where.language)",
    `query($itemId: ID!) { item(where: { itemId: $itemId }) { versions { version language { name } } } }`,
    { itemId }
  );
  await probe(
    environment,
    "versions with where.language=en (control)",
    `query($itemId: ID!, $lang: String!) { item(where: { itemId: $itemId, language: $lang }) { versions { version language { name } } } }`,
    { itemId, lang: "en" }
  );
  await probe(
    environment,
    "versions with where.language=fr (does it change scope?)",
    `query($itemId: ID!, $lang: String!) { item(where: { itemId: $itemId, language: $lang }) { versions { version language { name } } } }`,
    { itemId, lang: "fr" }
  );

  console.log("\n--- tenant-level languages (LanguageConnection) probes ---");
  await probe(environment, "languages.nodes.name", `query { languages { nodes { name } } }`, {});
  await probe(
    environment,
    "languages.nodes (full)",
    `query { languages { nodes { name englishName iso displayName } } }`,
    {}
  );
  await probe(
    environment,
    "languages.edges.node.name",
    `query { languages { edges { node { name } } } }`,
    {}
  );
  await probe(environment, "languages.totalCount", `query { languages { totalCount } }`, {});

  console.log("\n--- a Home-ish item with potential multi-language content ---");
  // Sitecore tenant root content path — try the standard SXA tenant root.
  await probe(
    environment,
    "item by path /sitecore/content { versions { language.name } }",
    `query { item(where: { path: "/sitecore/content" }) { versions { version language { name } } } }`,
    {}
  );
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
