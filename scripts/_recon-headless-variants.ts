/**
 * Recon: dump the tenant's Headless Variants tree(s) so we can compare
 * what scai emits against working variant items that the SXA Headless
 * Pages chrome actually surfaces in its dropdown.
 *
 * Read-only. Uses the default env (Agents) automation client.
 */
import { createAuthoringClient } from "@/recipe/api/authoring-client";
import { runAuthoringGraphQL } from "@/recipe/api/graphql";
import { resolveEnvironment } from "@/policy/environment";

const HEADLESS_VARIANTS_GROUPING = "da26c636-96e1-45e4-88d6-3fcec70d5699";
const HEADLESS_VARIANTS = "49c111d0-6867-4798-a724-1f103166e6e9";
const VARIANT_DEFINITION = "4d50cdae-c2d9-4de8-b080-8f992bfb1b55";

const normalizeGuid = (g: string): string => g.replace(/[{}]/g, "").toLowerCase();

const labelTemplate = (templateId: string | undefined): string => {
  if (!templateId) return "(unknown)";
  const n = normalizeGuid(templateId);
  if (n === normalizeGuid(VARIANT_DEFINITION)) return `${templateId} (VARIANT_DEFINITION ✓)`;
  if (n === normalizeGuid(HEADLESS_VARIANTS)) return `${templateId} (HEADLESS_VARIANTS ✓)`;
  if (n === normalizeGuid(HEADLESS_VARIANTS_GROUPING))
    return `${templateId} (HEADLESS_VARIANTS_GROUPING ✓)`;
  return `${templateId} (OTHER!)`;
};

const GET_CHILDREN_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    itemId
    name
    path
    children {
      nodes {
        itemId
        name
        path
        template { templateId }
      }
    }
  }
}`;

type Child = {
  itemId: string;
  name: string;
  path: string;
  template?: { templateId?: string };
};
type ChildrenResult = {
  item: {
    itemId: string;
    name: string;
    path: string;
    children: { nodes: Child[] };
  } | null;
};

async function main() {
  const { envName, environment, timeoutMs } = resolveEnvironment({});
  // resolveEnvironment returns the raw env profile; the auth layer
  // expects `name` for keychain lookup.
  const env = { ...environment, name: envName };
  const client = createAuthoringClient({
    environment: env,
    request: { timeoutMs },
  });

  console.log(`=== Using env: ${envName} (${environment.host}) ===`);
  console.log("env shape:", {
    name: env.name,
    host: env.host,
    clientId: env.clientId,
    automationClient: env.automationClient,
    organizationId: env.organizationId,
    orgClientId: env.orgClientId,
  });
  console.log();

  const listChildren = async (path: string): Promise<Child[]> => {
    const result = await runAuthoringGraphQL<ChildrenResult>(
      env,
      GET_CHILDREN_BY_PATH,
      { path },
      { timeoutMs }
    );
    return result.item?.children?.nodes ?? [];
  };

  // Walk /sitecore/content → collections → sites → look for Presentation/Headless Variants
  const collectionChildren = await listChildren("/sitecore/content");
  console.log(
    `top-level collections: ${collectionChildren.map((c) => c.name).join(", ") || "(none)"}`
  );

  for (const collection of collectionChildren) {
    const sites = await listChildren(collection.path);
    for (const site of sites) {
      const hvPath = `${site.path}/Presentation/Headless Variants`;
      const variantsRoot = await client.getItem({ path: hvPath });
      if (!variantsRoot) continue;

      console.log(`\n=== Headless Variants root ===`);
      console.log(`path: ${variantsRoot.path}`);
      console.log(`itemId: ${variantsRoot.itemId}`);

      const sections = await listChildren(variantsRoot.path);
      if (sections.length === 0) {
        console.log("(no children)");
        continue;
      }
      for (const section of sections) {
        console.log(`\n--- section: ${section.name} ---`);
        console.log(`  template: ${labelTemplate(section.template?.templateId)}`);
        const renderingFolders = await listChildren(section.path);
        for (const folder of renderingFolders) {
          console.log(`\n  rendering: ${folder.name}`);
          console.log(`    template: ${labelTemplate(folder.template?.templateId)}`);
          const variants = await listChildren(folder.path);
          for (const variant of variants) {
            console.log(`    • ${variant.name}`);
            console.log(`      template: ${labelTemplate(variant.template?.templateId)}`);
            const fullItem = await client.getItem({ itemId: variant.itemId });
            console.log("      own fields (non-empty):");
            for (const f of fullItem?.fields ?? []) {
              if (!f.value) continue;
              const truncated = f.value.length > 80 ? `${f.value.slice(0, 80)}...` : f.value;
              console.log(`        ${f.name} = ${JSON.stringify(truncated)}`);
            }
          }
        }
      }
    }
  }
  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
