/**
 * Recon: introspect the Authoring GraphQL schema for version-related
 * mutations, so the `AddItemVersion` executor binds to a verified mutation
 * rather than a guessed one.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_recon-authoring-mutations.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { runAuthoringGraphQL } from "@/recipe/api/graphql";

interface TypeRef {
  name?: string;
  kind?: string;
  ofType?: TypeRef | null;
}
const unwrap = (t: TypeRef | null | undefined): string => {
  if (!t) return "?";
  if (t.name) return t.name;
  if (t.ofType) return `${t.kind}<${unwrap(t.ofType)}>`;
  return t.kind ?? "?";
};

const QUERY = `
query {
  updateItemInput: __type(name: "UpdateItemInput") {
    inputFields { name type { name kind ofType { name kind ofType { name kind } } } }
  }
  fieldValueInput: __type(name: "FieldValueInput") {
    inputFields { name type { name kind ofType { name kind ofType { name kind } } } }
  }
}`;

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "test";
  const { environment } = resolveEnvironment({ environmentName: envName });

  const data = await runAuthoringGraphQL<{
    updateItemInput: { inputFields: { name: string; type: TypeRef }[] } | null;
    fieldValueInput: { inputFields: { name: string; type: TypeRef }[] } | null;
  }>(environment, QUERY);

  console.log("[recon] UpdateItemInput.inputFields:");
  for (const f of data.updateItemInput?.inputFields ?? []) {
    console.log(`  - ${f.name}: ${unwrap(f.type)}`);
  }
  console.log("[recon] FieldValueInput.inputFields:");
  for (const f of data.fieldValueInput?.inputFields ?? []) {
    console.log(`  - ${f.name}: ${unwrap(f.type)}`);
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
