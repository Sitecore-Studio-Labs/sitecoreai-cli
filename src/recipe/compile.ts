import {
  availableRenderingsSectionId,
  PAGE_DESIGNS_ROOT_REF_KEY,
  pageDesignId,
  renderingId,
  templateId,
} from "./guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "./ir/operations";
import { policyFor } from "./policy";
import {
  AVAILABLE_RENDERINGS_FIELDS,
  COMPOSITION_FIELDS,
  SITECORE_TEMPLATES,
} from "./ir/sitecore-templates";
import { type Recipe, RecipeSchema } from "./schema/recipe";
import { encodeTemplatesMapping } from "./layout/templates-mapping";

import { compileComponentTemplateRecipe } from "./compile/component-template";
import { compileContentTemplateRecipe } from "./compile/content-template";
import { compileParametersTemplateRecipe } from "./compile/parameters-template";
import { compileSectionDefinitionRecipe } from "./compile/section-definition";
import { compilePartialDesignRecipe } from "./compile/partial-design";
import { compilePageDesignRecipe } from "./compile/page-design";
import { compileContentItemRecipe } from "./compile/content-item";
import { compileSiteTemplateRecipe } from "./compile/site-template";
import { compileSiteRecipe } from "./compile/site";
import { compileEnumerationRecipe } from "./compile/enumeration";
import { joinPath, siteOf, type CompileContext } from "./compile/shared";

// Re-export per-kind compile functions so existing import paths
// (`import { compileComponentTemplateRecipe } from "@/recipe/compile"`)
// keep working.
export {
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  compileParametersTemplateRecipe,
  compileSectionDefinitionRecipe,
  compilePartialDesignRecipe,
  compilePageDesignRecipe,
  compileContentItemRecipe,
  compileSiteTemplateRecipe,
  compileSiteRecipe,
  compileEnumerationRecipe,
};

// Re-export the CompileContext type so callers can keep importing it
// from `@/recipe/compile` without reaching into the new sub-directory.
export type { CompileContext } from "./compile/shared";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to write
 * the cross-recipe `TemplatesMapping` aggregate. Not a real recipe — the
 * leading double-underscore signals "compiler-synthesized" and avoids
 * collision with any author-defined handle (recipe handles match
 * `[a-z][a-z0-9-]*@\d+`, so a leading underscore is unrepresentable).
 */
export const TEMPLATES_MAPPING_AGGREGATE_HANDLE = "__templates-mapping__";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to
 * materialise the per-section `Available Renderings` items. Same
 * compiler-synthesized convention as `TEMPLATES_MAPPING_AGGREGATE_HANDLE`.
 */
export const AVAILABLE_RENDERINGS_AGGREGATE_HANDLE = "__available-renderings__";

/**
 * Build the synthetic IR that materialises the SXA `Available Renderings`
 * section items for the recipe set, one per `recipe.section` value
 * across every component-template recipe.
 *
 * Each section emits two ops:
 *   1. `CreateItem` for `<availableRenderingsRoot>/<section>` (template:
 *      `AVAILABLE_RENDERINGS`). `CreateOnly` policy — the SetField
 *      below carries the actual rendering list and runs every push.
 *   2. `SetField(Renderings)` writing the pipe-separated rendering
 *      itemIds for that section. The value is a `ref-recipe-list`
 *      pointing at every `renderingId(handle)` in the section, which
 *      the executor resolves at apply-time against the captured-itemId
 *      map (seeded via `crossRecipeRefs` since the renderings live in
 *      sibling per-recipe IRs that ran earlier in the push).
 *
 * Returns null when no eligible recipes exist (no
 * `availableRenderingsRoot` configured, or no component-template
 * recipes carry a `section`).
 */
const buildAvailableRenderingsAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext
): OperationIr | null => {
  if (!context.availableRenderingsRoot) return null;

  const root = context.availableRenderingsRoot;
  const site = siteOf(context);

  // Group component-template recipes by section, preserving stable
  // ordering (sections in first-occurrence order across the input set;
  // recipes within each section sorted by handle for deterministic IR).
  const sectionToHandles = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    if (!recipe.section) continue;
    const list = sectionToHandles.get(recipe.section) ?? [];
    list.push(recipe.handle);
    sectionToHandles.set(recipe.section, list);
  }
  if (sectionToHandles.size === 0) return null;

  const operations: Operation[] = [];
  for (const [section, handles] of sectionToHandles) {
    const sectionRefKey = availableRenderingsSectionId(site, section);
    const sectionPath = joinPath(root, section);
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `available-renderings-section:${site}:${section}`,
      id: sectionRefKey,
      path: sectionPath,
      parent: { kind: "ref-path", value: root },
      templateOf: SITECORE_TEMPLATES.AVAILABLE_RENDERINGS,
      name: section,
      fields: [],
    } satisfies CreateItemOp);

    const sortedHandles = [...handles].sort((a, b) => a.localeCompare(b));
    operations.push({
      op: "SetField",
      policy: policyFor("composition-structure"),
      label: `available-renderings-list:${site}:${section}`,
      itemRefKey: sectionRefKey,
      fieldId: AVAILABLE_RENDERINGS_FIELDS.RENDERINGS,
      value: {
        kind: "ref-recipe-list",
        refKeys: sortedHandles.map((handle) => renderingId(site, handle)),
        // Tolerant: if a sibling recipe IR aborted and its rendering
        // wasn't created, write the rest rather than failing the whole
        // aggregate. The per-recipe IR's failure is already surfaced
        // via its own DEPLOY_FAILED — the aggregate shouldn't compound
        // the noise.
        tolerateMissing: true,
      },
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: AVAILABLE_RENDERINGS_AGGREGATE_HANDLE,
    operations,
  });
};

/**
 * Compile a coherent set of recipes to a list of Operation IRs.
 *
 * Returns one IR per recipe (via `compileRecipe`), plus, when any
 * `PageDesignRecipe` in the set declares `appliesTo`, a final synthetic
 * IR whose only op is the combined `SetField(TemplatesMapping)` write
 * on the Page Designs root.
 *
 * The TemplatesMapping field is cross-recipe by nature — every page
 * design contributes one entry per applies-to template, and the field
 * stores the union. Aggregating at compile time keeps the executor
 * untouched (one full-replace write of the union) and gives reviewers
 * a single combined op to inspect rather than N piecewise overwrites.
 *
 * Entries are sorted by `templateGuid` for deterministic output — the
 * IR is the comparable artifact, so order must not depend on input
 * recipe order. Within a single applies-to template, "last design
 * wins" is enforced by sorting (later entries with the same key
 * overwrite earlier ones), but that's a pathological config the
 * cross-recipe validator should already flag.
 */
export function compileRecipeSet(
  recipes: readonly Recipe[],
  context: CompileContext
): OperationIr[] {
  // Shared across the whole set: section / Component Folders /
  // Presentation Parameters / Content Models group folders only get
  // emitted once even when many recipes land in the same section.
  const emittedFolders = new Set<string>();
  const irs: OperationIr[] = recipes.map((recipe) => {
    switch (recipe.kind) {
      case "component-template":
        return compileComponentTemplateRecipe(recipe, context, emittedFolders);
      case "content-template":
        return compileContentTemplateRecipe(recipe, context, emittedFolders);
      case "parameters-template":
        return compileParametersTemplateRecipe(recipe, context, emittedFolders);
      default:
        return compileRecipe(recipe, context);
    }
  });

  const setSite = siteOf(context);
  const entries: { templateGuid: string; designGuid: string }[] = [];
  for (const recipe of recipes) {
    if (recipe.kind !== "page-design") continue;
    if (recipe.appliesTo.length === 0) continue;
    const designGuid = pageDesignId(setSite, recipe.handle);
    for (const tplHandle of recipe.appliesTo) {
      entries.push({ templateGuid: templateId(setSite, tplHandle), designGuid });
    }
  }

  if (entries.length > 0) {
    entries.sort((a, b) =>
      a.templateGuid === b.templateGuid
        ? a.designGuid.localeCompare(b.designGuid)
        : a.templateGuid.localeCompare(b.templateGuid)
    );

    const aggregateOp: SetFieldOp = {
      op: "SetField",
      policy: policyFor("composition-structure"),
      label: "templates-mapping:aggregate",
      itemRefKey: PAGE_DESIGNS_ROOT_REF_KEY,
      fieldId: COMPOSITION_FIELDS.TEMPLATES_MAPPING,
      value: { kind: "string", value: encodeTemplatesMapping(entries) },
    };

    irs.push(
      OperationIrSchema.parse({
        schemaVersion: "1",
        recipeHandle: TEMPLATES_MAPPING_AGGREGATE_HANDLE,
        operations: [aggregateOp],
      })
    );
  }

  // Available Renderings cross-recipe aggregate. Emitted last in the
  // IR list so per-recipe rendering CreateItem ops have already run
  // by the time this IR's SetField resolves the ref-recipe-list.
  const availableRenderings = buildAvailableRenderingsAggregate(recipes, context);
  if (availableRenderings) {
    irs.push(availableRenderings);
  }

  return irs;
}

/** Front-door dispatcher — accepts any registered recipe kind. */
export function compileRecipe(input: Recipe, context: CompileContext): OperationIr {
  const recipe = RecipeSchema.parse(input);
  switch (recipe.kind) {
    case "component-template":
      return compileComponentTemplateRecipe(recipe, context);
    case "content-template":
      return compileContentTemplateRecipe(recipe, context);
    case "content-item":
      return compileContentItemRecipe(recipe, context);
    case "parameters-template":
      return compileParametersTemplateRecipe(recipe, context);
    case "section-definition":
      return compileSectionDefinitionRecipe(recipe, context);
    case "partial-design":
      return compilePartialDesignRecipe(recipe, context);
    case "page-design":
      return compilePageDesignRecipe(recipe, context);
    case "site-template":
      return compileSiteTemplateRecipe(recipe, context);
    case "site":
      return compileSiteRecipe(recipe, context);
    case "enumeration":
      return compileEnumerationRecipe(recipe, context);
  }
}
