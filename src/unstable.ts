/**
 * Consolidated UNSTABLE SDK surface —
 * `import { brand, campaignsSchema, ... } from "@sitecoreai-labs/sitecoreai-cli/unstable"`.
 *
 * These domains are reverse-engineered against SitecoreAI product APIs
 * that carry no SemVer stability promise — their schemas, types, and
 * task runners may change shape between releases without a major bump.
 * They are grouped here, behind a single `./unstable` entry, instead of
 * nine separate `./unstable/*` subpaths, so the instability is signalled
 * once and the published surface stays small.
 *
 * Each export is a namespace:
 *
 *     import { brand, brandSchema } from "@sitecoreai-labs/sitecoreai-cli/unstable";
 *     const kit = brand.someTask(...);
 *     const schema = brandSchema.BrandKitRecipeSchema;
 *
 * The `*Schema` namespaces are the lightweight schema-only barrels (Zod
 * schemas + inferred types, no task/runtime code) — safe to import into
 * a browser / jsdom bundle.
 */

export * as agents from "./agents";
export * as agentsSchema from "@/agents/recipe/schema-only";
export * as brand from "./brand";
export * as brandSchema from "@/brand/recipe/schema-only";
export * as brief from "./brief";
export * as briefSchema from "@/brief/recipe/schema-only";
export * as campaigns from "./campaigns";
export * as campaignsSchema from "@/campaigns/recipe/schema-only";
export * as scripting from "./scripting";
export * as sites from "./sites";
