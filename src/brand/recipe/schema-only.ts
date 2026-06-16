/**
 * Schema-only brand entry —
 * `import { ... } from "@sitecoreai-labs/sitecoreai-cli/unstable/brand/schema"`.
 *
 * Re-exports ONLY the brand-kit recipe Zod schemas (`BrandKitRecipeSchema` and
 * its sub-shapes) with a zod-only module graph — none of the `/unstable/brand`
 * barrel's API clients, auth (`../shared/jwt`), pipelines, or sync logic.
 *
 * Schema-only consumers — e.g. a frontend that re-exports these schemas into
 * client-reachable code — import here so their bundle never pulls the brand
 * HTTP/auth machinery. `src/brand/recipe/schema.ts` imports only `zod`, so this
 * entry stays clean. Mirrors the `./recipe/schema` pattern.
 */

export * from "./schema";
