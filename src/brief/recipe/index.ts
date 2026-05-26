/**
 * The brief recipe surface — declarative definitions + `sync` support
 * for Sitecore Content Operations brief types AND brief instances.
 *
 * Two kinds:
 *   - `briefTypeKind` ("brief-type") — the schema template a brief is
 *     built against. Identified by stable codename.
 *   - `briefInstanceKind` ("brief") — a populated brief instance.
 *     Identified by display name; references its type by codename.
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

export {
  BriefInstanceRecipeSchema,
  BriefInstanceStatusSchema,
  BriefInstanceFieldsSchema,
  type BriefInstanceRecipe,
} from "./instance-schema";
export { diffBriefInstance } from "./instance-diff";
export { briefInstanceKind } from "./instance-kind";
