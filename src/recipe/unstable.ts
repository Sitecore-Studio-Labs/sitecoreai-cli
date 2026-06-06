/**
 * Unstable recipe API — `import { ... } from "@sitecoreai-labs/sitecoreai-cli/recipe/unstable"`.
 *
 * The recipe **composition kinds** — `ContentItem`, `PageDesign`,
 * `PartialDesign`, `SiteRecipe`, `SiteTemplate` — are present in the source
 * and usable, but they are NOT part of the 0.1.0 stability promise. Their
 * schemas, types, and compilers may change shape between minor releases
 * without a major bump. They graduate to the stable `./recipe` entry in a
 * follow-up release (see `.changeset/recipes-graduation.md`).
 *
 * The five stable recipe kinds — `ComponentTemplate`, `ContentTemplate`,
 * `ComponentSection`, `DesignParametersTemplate`, `Enumeration` — and all
 * shared recipe infrastructure (the `RecipeSchema` umbrella, `compileRecipe`,
 * the planner/executor, GUID derivation, IR) stay on the stable `./recipe`
 * entry.
 */

// Composition-kind schemas + types ----------------------------------------
export {
  ContentItemRecipeSchema,
  DictionaryPhraseSchema,
  DictionaryRecipeSchema,
  PageDesignRecipeSchema,
  PartialDesignRecipeSchema,
  SiteGroupingSchema,
  SiteRecipeSchema,
  SiteTemplateRecipeSchema,
  SiteTemplateTaxonomyEntrySchema,
  type ContentItemRecipe,
  type DictionaryPhrase,
  type DictionaryRecipe,
  type PageDesignRecipe,
  type PartialDesignRecipe,
  type SiteGrouping,
  type SiteRecipe,
  type SiteTemplateRecipe,
  type SiteTemplateTaxonomyEntry,
} from "./schema/recipe";

// Composition-kind compilers ----------------------------------------------
export {
  compileContentItemRecipe,
  compileDictionaryRecipe,
  compilePageDesignRecipe,
  compilePartialDesignRecipe,
  compileSiteRecipe,
  compileSiteTemplateRecipe,
} from "./compile";
