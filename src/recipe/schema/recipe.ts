/**
 * Recipe author surface — what users hand-author for one Sitecore template.
 *
 * **This file is a THIN AGGREGATOR.** The schemas live in cohesive
 * per-concern modules:
 *
 *   - `./shared`         — shared building blocks (field/source augments,
 *                          datasource, placeholder definition, meta, the
 *                          `HANDLE_PATTERN` / `FolderPath` / `resolveAllowedHandles`
 *                          primitives).
 *   - `./content-values` — content field-value + layout + placement
 *                          primitives shared by content/page/design kinds.
 *   - `./kinds/*`        — one module per recipe kind (or cohesive group):
 *                          component, content, page, design, site,
 *                          enumeration, workflow.
 *
 * This module RE-EXPORTS every symbol those modules expose (so every
 * `from "./schema/recipe"` import keeps resolving to the same symbol)
 * and assembles the `RecipeSchema` discriminated-union umbrella.
 *
 * Two recipe kinds anchor the surface:
 *
 *   ComponentTemplateRecipe — Has a rendering. Becomes a placeable component
 *                             on Sitecore pages. Owns its datasource template
 *                             AND its rendering item.
 *   ContentTemplateRecipe   — Fields only, no rendering. A data shape
 *                             referenced by other recipes (Treelist source,
 *                             child-item pattern, etc.). Not placeable on a
 *                             page directly.
 *
 * **These schemas must stay in sync with the registry's working copy at
 * `<registry>/src/lib/registry/sitecore-recipes.ts`.** Once scai exposes a
 * typed recipe export, the registry imports from scai and the duplication
 * goes away.
 *
 * The `handle` is load-bearing forever — a uuidv5 derives every item GUID
 * from it (see `guids.ts`), so renaming a handle creates a *different*
 * template.
 *
 * **Cross-field refinement note.** Cross-field validations that
 * `discriminatedUnion` can't express (workflow `initialState ∈ states`,
 * enumeration `default ∈ values`, webhook auth `Ref` XOR `Path`) live in
 * the compilers — NOT on these schemas — because Zod's
 * `discriminatedUnion` rejects `ZodEffects` members and these schemas
 * must be members of `RecipeSchema`.
 */

import { z } from "zod";

import {
  ComponentSectionRecipeSchema,
  ComponentTemplateRecipeSchema,
  PlaceholderRecipeSchema,
} from "./kinds/component";
import {
  ContentItemRecipeSchema,
  ContentTemplateRecipeSchema,
  DesignParametersTemplateRecipeSchema,
} from "./kinds/content";
import {
  PageDesignRecipeSchema,
  PartialDesignRecipeSchema,
  VariantRecipeSchema,
} from "./kinds/design";
import { DictionaryRecipeSchema, SiteRecipeSchema, SiteTemplateRecipeSchema } from "./kinds/site";
import { EnumerationRecipeSchema } from "./kinds/enumeration";
import { WebhookAuthorizationRecipeSchema, WorkflowRecipeSchema } from "./kinds/workflow";
import { PageRecipeSchema, PageTemplateRecipeSchema } from "./kinds/page";

// Shared building blocks --------------------------------------------------
export {
  DesignParameterSchema,
  FieldDefinitionSchema,
  FolderPath,
  HANDLE_PATTERN,
  PlaceholderDefinitionSchema,
  RecipeDatasourceSchema,
  RecipeMetaSchema,
  RecipeMetaTaxSchema,
  RenderingDatasourceLocationSchema,
  RenderingVariantDefinitionSchema,
  SitecoreFieldAugmentSchema,
  SitecoreFieldSourceSchema,
  resolveAllowedHandles,
  type DesignParameter,
  type FieldDefinition,
  type PlaceholderDefinition,
  type RecipeDatasource,
  type RecipeMeta,
  type RenderingDatasourceLocation,
  type RenderingVariantDefinition,
  type SitecoreFieldAugment,
  type SitecoreFieldSource,
} from "./shared";

// Content-value + layout primitives ---------------------------------------
export {
  ComponentPlacementSchema,
  ContentFieldValueSchema,
  ContentTranslationSchema,
  ContentVariantSchema,
  ContentVersionSchema,
  LayoutSchema,
  type ComponentPlacement,
  type ContentFieldValue,
  type ContentTranslation,
  type ContentVariant,
  type ContentVersion,
  type Layout,
} from "./content-values";

// Per-kind schemas --------------------------------------------------------
export {
  ComponentSectionRecipeSchema,
  ComponentTemplateRecipeSchema,
  PlaceholderRecipeSchema,
  type ComponentSectionRecipe,
  type ComponentTemplateRecipe,
  type PlaceholderRecipe,
} from "./kinds/component";

export {
  ContentItemRecipeSchema,
  ContentTemplateRecipeSchema,
  DesignParametersTemplateRecipeSchema,
  type ContentItemRecipe,
  type ContentTemplateRecipe,
  type DesignParametersTemplateRecipe,
} from "./kinds/content";

export {
  PageRecipeSchema,
  PageTemplateRecipeSchema,
  type PageRecipe,
  type PageTemplateRecipe,
} from "./kinds/page";

export {
  PageDesignRecipeSchema,
  PartialDesignRecipeSchema,
  VariantRecipeSchema,
  type PageDesignRecipe,
  type PartialDesignRecipe,
  type VariantRecipe,
} from "./kinds/design";

export {
  DictionaryPhraseSchema,
  DictionaryRecipeSchema,
  SiteGroupingSchema,
  SiteRecipeSchema,
  SiteTemplateRecipeSchema,
  SiteTemplateTaxonomyEntrySchema,
  type DictionaryPhrase,
  type DictionaryRecipe,
  type SiteGrouping,
  type SiteRecipe,
  type SiteTemplateRecipe,
  type SiteTemplateTaxonomyEntry,
} from "./kinds/site";

export {
  EnumerationRecipeSchema,
  EnumerationValueSchema,
  type EnumerationRecipe,
  type EnumerationValue,
} from "./kinds/enumeration";

export {
  WebhookAuthorizationRecipeSchema,
  WorkflowRecipeSchema,
  type WebhookAuthorizationRecipe,
  type WorkflowRecipe,
} from "./kinds/workflow";

/**
 * Discriminated union of recipe kinds. Compilers and validators can accept
 * `Recipe` and dispatch on `kind`.
 */
export const RecipeSchema = z.discriminatedUnion("kind", [
  ComponentSectionRecipeSchema,
  ComponentTemplateRecipeSchema,
  ContentTemplateRecipeSchema,
  ContentItemRecipeSchema,
  PageTemplateRecipeSchema,
  PageRecipeSchema,
  PlaceholderRecipeSchema,
  DesignParametersTemplateRecipeSchema,
  PartialDesignRecipeSchema,
  VariantRecipeSchema,
  PageDesignRecipeSchema,
  SiteTemplateRecipeSchema,
  SiteRecipeSchema,
  DictionaryRecipeSchema,
  EnumerationRecipeSchema,
  WorkflowRecipeSchema,
  WebhookAuthorizationRecipeSchema,
]);

export type Recipe = z.infer<typeof RecipeSchema>;

// ---------------------------------------------------------------------------
// Compiler-internal "parsed" recipe shapes (post-`.parse()`, every default
// present).
//
// The public `<Kind>Recipe` types above are `z.input` — the AUTHORING shape,
// where `.default(...)` fields are OPTIONAL so a hand-authored object literal
// (`{ ... } satisfies ComponentTemplateRecipe`) doesn't have to spell out the
// defaults. scai's compiler, by contrast, always operates on the PARSED recipe
// (`<Kind>RecipeSchema.parse(input)` runs at every compile entry), where those
// fields are guaranteed present. These `<Kind>RecipeParsed` aliases give that
// post-parse shape an explicit name so compiler-internal helpers — which only
// ever receive parsed recipes — can be typed on the output rather than the
// (looser) authoring input.
// ---------------------------------------------------------------------------
export type ComponentSectionRecipeParsed = z.output<typeof ComponentSectionRecipeSchema>;
export type ComponentTemplateRecipeParsed = z.output<typeof ComponentTemplateRecipeSchema>;
export type PlaceholderRecipeParsed = z.output<typeof PlaceholderRecipeSchema>;
export type ContentTemplateRecipeParsed = z.output<typeof ContentTemplateRecipeSchema>;
export type ContentItemRecipeParsed = z.output<typeof ContentItemRecipeSchema>;
export type DesignParametersTemplateRecipeParsed = z.output<
  typeof DesignParametersTemplateRecipeSchema
>;
export type PageRecipeParsed = z.output<typeof PageRecipeSchema>;
export type PageTemplateRecipeParsed = z.output<typeof PageTemplateRecipeSchema>;
export type PartialDesignRecipeParsed = z.output<typeof PartialDesignRecipeSchema>;
export type PageDesignRecipeParsed = z.output<typeof PageDesignRecipeSchema>;
export type VariantRecipeParsed = z.output<typeof VariantRecipeSchema>;
export type SiteRecipeParsed = z.output<typeof SiteRecipeSchema>;
export type SiteTemplateRecipeParsed = z.output<typeof SiteTemplateRecipeSchema>;
export type DictionaryRecipeParsed = z.output<typeof DictionaryRecipeSchema>;
export type EnumerationRecipeParsed = z.output<typeof EnumerationRecipeSchema>;
export type WorkflowRecipeParsed = z.output<typeof WorkflowRecipeSchema>;
export type WebhookAuthorizationRecipeParsed = z.output<typeof WebhookAuthorizationRecipeSchema>;
export type RecipeParsed = z.output<typeof RecipeSchema>;
