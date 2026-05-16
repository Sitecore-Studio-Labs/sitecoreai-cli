/**
 * The `brief-type` recipe kind — declarative definition + `sync` support
 * for Sitecore Content Operations brief types.
 *
 * See docs/recipe-sync-architecture.md.
 */
export {
  BriefTypeRecipeSchema,
  BriefFieldSchema,
  RichTextFieldSchema,
  DateTimeFieldSchema,
  TimelineFieldSchema,
  BudgetFieldSchema,
  LocalizedStringSchema,
  type BriefTypeRecipe,
  type BriefRecipeField,
  type RecipeLocalizedString,
} from "./schema";
export { diffBriefType } from "./diff";
export { resolveBriefClient } from "./client";
export { briefTypeKind } from "./kind";
