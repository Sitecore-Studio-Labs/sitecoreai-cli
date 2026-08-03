/**
 * Unstable recipe API — `import { ... } from "@sitecoreai-labs/sitecoreai-cli/recipe/unstable"`.
 *
 * @deprecated for the four graduated kinds. `ContentItemRecipe`,
 * `PageDesignRecipe`, `PartialDesignRecipe`, and `DictionaryRecipe` — and
 * their compilers — now live on the stable `./recipe` entry. They are
 * still re-exported here so existing imports keep working through a
 * deprecation window; migrate to `./recipe` at your convenience. This
 * entry keeps the re-exports until the next major.
 *
 * Still genuinely unstable: **`SiteRecipe`** and **`SiteTemplateRecipe`**.
 * Their schemas, types, and compilers may change shape between minor
 * releases without a major bump. Two things kept them back:
 *
 *  - Far less first-party exercise — ~10 files across the showcase
 *    registry between them, versus ~106 for the four that graduated.
 *  - Weaker rollback. Every op the graduated kinds emit (`CreateItem`,
 *    `SetField`, `AddItemVersion`) has an inverse in
 *    `rollback/rollback.ts`. `SiteRecipe` emits `CreateSiteFromTemplate`
 *    and `SiteTemplateRecipe` emits `MediaUpload`; both are deliberately
 *    warn-only on rollback (site deletion cascades destructively;
 *    media upload can't yet tell "created" from "re-used"), so a
 *    half-failed push of either leaves residue the pipeline won't unwind.
 *
 * All shared recipe infrastructure (the `RecipeSchema` umbrella,
 * `compileRecipe`, the planner/executor, GUID derivation, IR) has always
 * been on the stable `./recipe` entry.
 */

// Graduated kinds — re-exported for the deprecation window ----------------
// These four now live on `./recipe`. Import from there in new code.
export {
  ContentItemRecipeSchema,
  DictionaryPhraseSchema,
  DictionaryRecipeSchema,
  PageDesignRecipeSchema,
  PartialDesignRecipeSchema,
  type ContentItemRecipe,
  type DictionaryPhrase,
  type DictionaryRecipe,
  type PageDesignRecipe,
  type PartialDesignRecipe,
} from "./schema/recipe";

export {
  compileContentItemRecipe,
  compileDictionaryRecipe,
  compilePageDesignRecipe,
  compilePartialDesignRecipe,
} from "./compile";

// Still unstable ----------------------------------------------------------
export {
  SiteGroupingSchema,
  SiteRecipeSchema,
  SiteTemplateRecipeSchema,
  SiteTemplateTaxonomyEntrySchema,
  type SiteGrouping,
  type SiteRecipe,
  type SiteTemplateRecipe,
  type SiteTemplateTaxonomyEntry,
} from "./schema/recipe";

export { compileSiteRecipe, compileSiteTemplateRecipe } from "./compile";
