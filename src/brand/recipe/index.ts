/**
 * The `brand-kit` recipe kind — declarative definition + `sync` support
 * for Sitecore brand kits.
 *
 * See docs/recipe-sync-architecture.md.
 */
export {
  BrandKitRecipeSchema,
  BrandFieldValueSchema,
  BrandDocumentSchema,
  BrandRichEntrySchema,
  type BrandKitRecipe,
  type BrandFieldValue,
  type BrandDocument,
} from "./schema";
export { diffBrandKit } from "./diff";
export { resolveBrandClient } from "./client";
export { brandKitKind } from "./kind";
