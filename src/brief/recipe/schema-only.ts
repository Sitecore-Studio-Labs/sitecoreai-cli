/**
 * Schema-only brief entry —
 * `import { ... } from "@sitecoreai-labs/sitecoreai-cli/unstable/brief/schema"`.
 *
 * Re-exports ONLY the brief Zod schemas — both the brief-TYPE schema
 * (`BriefTypeRecipeSchema` + field shapes) and the brief-INSTANCE schema
 * (`BriefInstanceRecipeSchema` + milestone/comment/reference shapes) — with a
 * zod-only module graph. None of the `/unstable/brief` barrel's API clients,
 * auth, or sync logic is pulled.
 *
 * `src/brief/recipe/{schema,instance-schema}.ts` each import only `zod`, so this
 * entry stays clean. Mirrors the `./recipe/schema` pattern.
 */

export * from "./schema";
export * from "./instance-schema";
