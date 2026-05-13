import { createScaiError } from "@/shared/errors";
import type { Recipe } from "./schema/recipe";

/**
 * Cross-recipe validation: walks every handle reference in a recipe set
 * and verifies it resolves to an extant recipe of the right kind.
 *
 * `compileRecipe` operates on one recipe at a time and can't see the
 * surrounding set; this module is the seam that catches dangling or
 * mistyped references before the planner / executor swallows them.
 *
 * Reference inventory checked:
 *
 *   ComponentTemplateRecipe / ContentTemplateRecipe
 *     fields[*].sitecore.sourceTypes[*]   → any template-bearing recipe
 *     params[*].sitecore.sourceTypes[*]   → any template-bearing recipe
 *     insertOptions[*]                    → any template-bearing recipe
 *
 *   ContentItemRecipe
 *     templateType                        → any template-bearing recipe
 *     fields[*].link-internal.ref         → any recipe
 *     fields[*].reference.refs[*]         → any recipe
 *
 *   PartialDesignRecipe
 *     layout.placeholders[*][*].componentHandle           → ComponentTemplateRecipe
 *     layout.placeholders[*][*].datasourceRef.handle      → ContentItemRecipe
 *
 *   PageDesignRecipe
 *     appliesTo[*]                        → ContentTemplateRecipe (page templates)
 *     partials[*]                         → PartialDesignRecipe
 *     layout.placeholders[*][*].componentHandle           → ComponentTemplateRecipe
 *     layout.placeholders[*][*].datasourceRef.handle      → ContentItemRecipe
 *
 * Cycle detection covers `insertOptions` chains
 * (`ComponentTemplate.insertOptions → ContentTemplate.insertOptions → …`)
 * — the only place the current schema permits transitive recipe-to-recipe
 * references that could loop. Partial-to-partial cycles aren't possible
 * today (`PartialDesignRecipe` doesn't reference other partials); when
 * sub-partial composition lands (Phase 5+), extend the DFS below.
 */

export type RecipeKind = Recipe["kind"];

const TEMPLATE_KINDS: readonly RecipeKind[] = ["component-template", "content-template"];
const COMPONENT_TEMPLATE_KINDS: readonly RecipeKind[] = ["component-template"];
const CONTENT_TEMPLATE_KINDS: readonly RecipeKind[] = ["content-template"];
const CONTENT_ITEM_KINDS: readonly RecipeKind[] = ["content-item"];
const PARAMETERS_TEMPLATE_KINDS: readonly RecipeKind[] = ["design-parameters-template"];
const SECTION_DEFINITION_KINDS: readonly RecipeKind[] = ["section-definition"];
const PARTIAL_DESIGN_KINDS: readonly RecipeKind[] = ["partial-design"];
const PAGE_DESIGN_KINDS: readonly RecipeKind[] = ["page-design"];
const SITE_TEMPLATE_KINDS: readonly RecipeKind[] = ["site-template"];
const ANY_KINDS: readonly RecipeKind[] = [
  "component-template",
  "content-template",
  "content-item",
  "design-parameters-template",
  "section-definition",
  "partial-design",
  "page-design",
];

/** A handle reference that doesn't resolve, or resolves to the wrong kind. */
export interface UnresolvedHandle {
  /** Handle of the recipe that contains the bad reference. */
  fromRecipe: string;
  /** Dotted path inside the recipe — `layout.placeholders./header.0.componentHandle`. */
  fromField: string;
  /** The reference value that didn't resolve. */
  handle: string;
  /** Which recipe kinds would be valid resolutions. */
  expectedKinds: readonly RecipeKind[];
  /** The kind that was found (or undefined if no recipe with that handle exists). */
  actualKind: RecipeKind | undefined;
}

/** A handle that appears more than once in the recipe set. */
export interface DuplicateHandle {
  handle: string;
  count: number;
}

/** A cyclic chain of `insertOptions` references. */
export interface CyclicReference {
  /** First handle in the cycle. */
  startHandle: string;
  /** Ordered handles that form the cycle (last entry = startHandle, closing the loop). */
  cycle: readonly string[];
}

/**
 * A field-shape constraint that Zod can't enforce. Today this is the
 * `SiteRecipe` collectionId XOR collectionName presence check — the
 * Zod schema can't carry a `.refine()` because `RecipeSchema` is a
 * discriminated union, and discriminated unions reject `ZodEffects`
 * members. Cross-field constraints land here instead.
 */
export interface FieldShapeError {
  /** Handle of the recipe with the bad shape. */
  fromRecipe: string;
  /** Dotted path to the field(s) involved. */
  fromField: string;
  /** Operator-readable explanation. */
  message: string;
}

export interface ValidationResult {
  unresolvedHandles: UnresolvedHandle[];
  duplicateHandles: DuplicateHandle[];
  cycles: CyclicReference[];
  fieldShapeErrors: FieldShapeError[];
}

export const isValid = (result: ValidationResult): boolean =>
  result.unresolvedHandles.length === 0 &&
  result.duplicateHandles.length === 0 &&
  result.cycles.length === 0 &&
  result.fieldShapeErrors.length === 0;

/**
 * Render a `ValidationResult` as a multi-line, human-readable error
 * report. Use `validateRecipeSetOrThrow` if you just want exceptions.
 */
export function formatValidationErrors(result: ValidationResult): string {
  const lines: string[] = [];
  for (const dup of result.duplicateHandles) {
    lines.push(`Duplicate handle '${dup.handle}' (appears ${dup.count} times in the recipe set).`);
  }
  for (const cycle of result.cycles) {
    lines.push(`Cyclic insertOptions chain: ${cycle.cycle.join(" → ")}.`);
  }
  for (const err of result.unresolvedHandles) {
    const found =
      err.actualKind === undefined
        ? "no recipe with that handle in the set"
        : `found a ${err.actualKind} recipe`;
    lines.push(
      `${err.fromRecipe} → ${err.fromField}: '${err.handle}' is invalid (${found}; expected one of: ${err.expectedKinds.join(", ")}).`
    );
  }
  for (const err of result.fieldShapeErrors) {
    lines.push(`${err.fromRecipe} → ${err.fromField}: ${err.message}`);
  }
  return lines.join("\n");
}

/**
 * Validate cross-recipe references in a recipe set. Returns a result
 * with all detected problems — caller decides whether to throw, log,
 * or surface them in CLI output.
 */
export function validateRecipeSet(recipes: readonly Recipe[]): ValidationResult {
  const index = new Map<string, Recipe>();
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    counts.set(recipe.handle, (counts.get(recipe.handle) ?? 0) + 1);
    if (!index.has(recipe.handle)) {
      index.set(recipe.handle, recipe);
    }
  }

  const duplicateHandles: DuplicateHandle[] = [];
  for (const [handle, count] of counts) {
    if (count > 1) duplicateHandles.push({ handle, count });
  }

  const unresolved: UnresolvedHandle[] = [];
  const fieldShapeErrors: FieldShapeError[] = [];

  const checkRef = (
    fromRecipe: string,
    fromField: string,
    handle: string,
    expectedKinds: readonly RecipeKind[]
  ): void => {
    const target = index.get(handle);
    if (target === undefined) {
      unresolved.push({
        fromRecipe,
        fromField,
        handle,
        expectedKinds,
        actualKind: undefined,
      });
      return;
    }
    if (!expectedKinds.includes(target.kind)) {
      unresolved.push({
        fromRecipe,
        fromField,
        handle,
        expectedKinds,
        actualKind: target.kind,
      });
    }
  };

  for (const recipe of recipes) {
    switch (recipe.kind) {
      case "component-template":
        recipe.fields.forEach((field, idx) => {
          field.sitecore?.sourceTypes?.forEach((handle, sIdx) => {
            checkRef(
              recipe.handle,
              `fields.${idx}.sitecore.sourceTypes.${sIdx}`,
              handle,
              TEMPLATE_KINDS
            );
          });
        });
        recipe.params.forEach((param, idx) => {
          param.sitecore?.sourceTypes?.forEach((handle, sIdx) => {
            checkRef(
              recipe.handle,
              `params.${idx}.sitecore.sourceTypes.${sIdx}`,
              handle,
              TEMPLATE_KINDS
            );
          });
        });
        recipe.insertOptions?.forEach((handle, idx) => {
          checkRef(recipe.handle, `insertOptions.${idx}`, handle, TEMPLATE_KINDS);
        });
        if (recipe.datasource?.template) {
          checkRef(
            recipe.handle,
            "datasource.template.handle",
            recipe.datasource.template.handle,
            CONTENT_TEMPLATE_KINDS
          );
        }
        if (recipe.parameters) {
          checkRef(
            recipe.handle,
            "parameters.handle",
            recipe.parameters.handle,
            PARAMETERS_TEMPLATE_KINDS
          );
        }
        recipe.children?.allowedHandles.forEach((handle, idx) => {
          checkRef(recipe.handle, `children.allowedHandles.${idx}`, handle, TEMPLATE_KINDS);
        });
        recipe.availableIn?.forEach((handle, idx) => {
          checkRef(recipe.handle, `availableIn.${idx}`, handle, SECTION_DEFINITION_KINDS);
        });
        break;
      case "design-parameters-template":
        recipe.params.forEach((param, idx) => {
          param.sitecore?.sourceTypes?.forEach((handle, sIdx) => {
            checkRef(
              recipe.handle,
              `params.${idx}.sitecore.sourceTypes.${sIdx}`,
              handle,
              TEMPLATE_KINDS
            );
          });
        });
        break;
      case "section-definition":
        // Section definitions don't carry cross-recipe references — they
        // ARE the resolution target for `availableIn`.
        break;
      case "content-template":
        recipe.fields.forEach((field, idx) => {
          field.sitecore?.sourceTypes?.forEach((handle, sIdx) => {
            checkRef(
              recipe.handle,
              `fields.${idx}.sitecore.sourceTypes.${sIdx}`,
              handle,
              TEMPLATE_KINDS
            );
          });
        });
        recipe.insertOptions?.forEach((handle, idx) => {
          checkRef(recipe.handle, `insertOptions.${idx}`, handle, TEMPLATE_KINDS);
        });
        break;
      case "content-item":
        checkRef(recipe.handle, "templateType", recipe.templateType, TEMPLATE_KINDS);
        for (const [fieldName, value] of Object.entries(recipe.fields)) {
          if (value.shape === "link-internal") {
            checkRef(recipe.handle, `fields.${fieldName}.ref`, value.ref, ANY_KINDS);
          } else if (value.shape === "reference") {
            value.refs.forEach((handle, idx) => {
              checkRef(recipe.handle, `fields.${fieldName}.refs.${idx}`, handle, ANY_KINDS);
            });
          }
        }
        break;
      case "partial-design":
        for (const [phKey, placements] of Object.entries(recipe.layout.placeholders)) {
          placements.forEach((placement, idx) => {
            checkRef(
              recipe.handle,
              `layout.placeholders.${phKey}.${idx}.componentHandle`,
              placement.componentHandle,
              COMPONENT_TEMPLATE_KINDS
            );
            if (placement.datasourceRef?.kind === "shared") {
              checkRef(
                recipe.handle,
                `layout.placeholders.${phKey}.${idx}.datasourceRef.handle`,
                placement.datasourceRef.handle,
                CONTENT_ITEM_KINDS
              );
            }
          });
        }
        break;
      case "page-design":
        recipe.appliesTo.forEach((handle, idx) => {
          checkRef(recipe.handle, `appliesTo.${idx}`, handle, CONTENT_TEMPLATE_KINDS);
        });
        recipe.partials.forEach((handle, idx) => {
          checkRef(recipe.handle, `partials.${idx}`, handle, PARTIAL_DESIGN_KINDS);
        });
        if (recipe.layout) {
          for (const [phKey, placements] of Object.entries(recipe.layout.placeholders)) {
            placements.forEach((placement, idx) => {
              checkRef(
                recipe.handle,
                `layout.placeholders.${phKey}.${idx}.componentHandle`,
                placement.componentHandle,
                COMPONENT_TEMPLATE_KINDS
              );
              if (placement.datasourceRef?.kind === "shared") {
                checkRef(
                  recipe.handle,
                  `layout.placeholders.${phKey}.${idx}.datasourceRef.handle`,
                  placement.datasourceRef.handle,
                  CONTENT_ITEM_KINDS
                );
              }
            });
          }
        }
        break;
      case "site-template":
        recipe.pageTemplates.forEach((handle, idx) => {
          checkRef(recipe.handle, `pageTemplates.${idx}`, handle, CONTENT_TEMPLATE_KINDS);
        });
        recipe.pageDesigns.forEach((handle, idx) => {
          checkRef(recipe.handle, `pageDesigns.${idx}`, handle, PAGE_DESIGN_KINDS);
        });
        if (recipe.insertOptionsMatrix) {
          for (const [parentHandle, allowedChildren] of Object.entries(
            recipe.insertOptionsMatrix
          )) {
            // The KEY is itself a page-template handle. Validate it too —
            // a typo in the key would silently never apply at apply time.
            checkRef(
              recipe.handle,
              `insertOptionsMatrix.${parentHandle}`,
              parentHandle,
              CONTENT_TEMPLATE_KINDS
            );
            allowedChildren.forEach((childHandle, idx) => {
              checkRef(
                recipe.handle,
                `insertOptionsMatrix.${parentHandle}.${idx}`,
                childHandle,
                CONTENT_TEMPLATE_KINDS
              );
            });
          }
        }
        if (recipe.templatesToDesigns) {
          for (const [templateHandle, designHandle] of Object.entries(recipe.templatesToDesigns)) {
            checkRef(
              recipe.handle,
              `templatesToDesigns.${templateHandle} (key)`,
              templateHandle,
              CONTENT_TEMPLATE_KINDS
            );
            checkRef(
              recipe.handle,
              `templatesToDesigns.${templateHandle}`,
              designHandle,
              PAGE_DESIGN_KINDS
            );
          }
        }
        break;
      case "site":
        checkRef(recipe.handle, "siteTemplate", recipe.siteTemplate, SITE_TEMPLATE_KINDS);
        if (recipe.initialHome !== undefined) {
          // PageRecipe doesn't exist yet — accept any kind. When
          // PageRecipe lands, narrow this to PAGE_RECIPE_KINDS.
          checkRef(recipe.handle, "initialHome", recipe.initialHome, ANY_KINDS);
        }
        // Cross-field shape: SiteRecipe must specify exactly one of
        // collectionId or collectionName. The Zod schema can't enforce
        // it (discriminated union members can't carry refines), so the
        // constraint lives here.
        if (recipe.collectionId && recipe.collectionName) {
          fieldShapeErrors.push({
            fromRecipe: recipe.handle,
            fromField: "collectionId, collectionName",
            message:
              "collectionId and collectionName are mutually exclusive — provide one, not both",
          });
        }
        if (!recipe.collectionId && !recipe.collectionName) {
          fieldShapeErrors.push({
            fromRecipe: recipe.handle,
            fromField: "collectionId, collectionName",
            message: "either collectionId (existing) or collectionName (new) must be provided",
          });
        }
        break;
    }
  }

  const cycles = detectInsertOptionsCycles(index, recipes);

  return { unresolvedHandles: unresolved, duplicateHandles, cycles, fieldShapeErrors };
}

/**
 * DFS over `insertOptions` edges. Each unique cycle is reported once,
 * normalized to start at the alphabetically-smallest handle so re-runs
 * over the same input produce stable output regardless of iteration
 * order.
 */
function detectInsertOptionsCycles(
  index: ReadonlyMap<string, Recipe>,
  recipes: readonly Recipe[]
): CyclicReference[] {
  const cycles = new Map<string, CyclicReference>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const inStack = new Set<string>();

  const dfs = (handle: string): void => {
    if (inStack.has(handle)) {
      const cycleStart = stack.indexOf(handle);
      const ring = stack.slice(cycleStart);
      const minIdx = ring.reduce((acc, h, i) => (h < ring[acc] ? i : acc), 0);
      const normalized = [...ring.slice(minIdx), ...ring.slice(0, minIdx), ring[minIdx]];
      const key = normalized.join("→");
      if (!cycles.has(key)) {
        cycles.set(key, { startHandle: normalized[0], cycle: normalized });
      }
      return;
    }
    if (visited.has(handle)) return;

    visited.add(handle);
    inStack.add(handle);
    stack.push(handle);

    const recipe = index.get(handle);
    if (
      recipe !== undefined &&
      (recipe.kind === "component-template" || recipe.kind === "content-template") &&
      recipe.insertOptions !== undefined
    ) {
      for (const child of recipe.insertOptions) {
        dfs(child);
      }
    }

    stack.pop();
    inStack.delete(handle);
  };

  for (const recipe of recipes) {
    if (!visited.has(recipe.handle)) dfs(recipe.handle);
  }

  return [...cycles.values()];
}

/**
 * Convenience: validate and throw on any error. Use in pipelines that
 * should hard-stop before compilation when the recipe set is malformed.
 */
export function validateRecipeSetOrThrow(recipes: readonly Recipe[]): void {
  const result = validateRecipeSet(recipes);
  if (!isValid(result)) {
    throw createScaiError(
      `Recipe set validation failed:\n${formatValidationErrors(result)}`,
      "INPUT_INVALID"
    );
  }
}
