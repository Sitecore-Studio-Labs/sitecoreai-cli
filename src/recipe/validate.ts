import { createScaiError } from "@/shared/errors";
import type { Recipe } from "./schema/recipe";
import { resolveAllowedHandles } from "./schema/recipe";
import { recipeReferences } from "./references";

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
 *     fields[*].sitecore.source.types[*]   → any template-bearing recipe
 *     params[*].sitecore.source.types[*]  → any template-bearing recipe
 *     insertOptions[*]                    → any template-bearing recipe
 *
 *   ComponentTemplateRecipe
 *     placeholders[*].allowedComponents[*]→ ComponentTemplateRecipe
 *
 *   ContentItemRecipe
 *     templateType                        → any template-bearing recipe
 *     fields[*].link-internal.ref         → any recipe
 *     fields[*].reference.refs[*]         → any recipe
 *
 *   PageTemplateRecipe
 *     fields[*].sitecore.source.types[*]   → any template-bearing recipe
 *     insertOptions[*]                    → PageTemplateRecipe
 *     layout.placeholders[*][*].componentHandle           → ComponentTemplateRecipe
 *     layout.placeholders[*][*].datasourceRef.handle      → ContentItemRecipe
 *
 *   PlaceholderRecipe
 *     allowedComponents[*]                → ComponentTemplateRecipe
 *
 *   PageRecipe
 *     template                            → PageTemplateRecipe
 *     fields[*].link-internal.ref          → any recipe
 *     fields[*].reference.refs[*]          → any recipe
 *     layout.placeholders[*][*].componentHandle      → ComponentTemplateRecipe
 *     layout.placeholders[*][*].datasourceRef.handle → ContentItemRecipe
 *
 *   PartialDesignRecipe
 *     layout.placeholders[*][*].componentHandle           → ComponentTemplateRecipe
 *     layout.placeholders[*][*].datasourceRef.handle      → ContentItemRecipe
 *
 *   PageDesignRecipe
 *     appliesTo[*]                        → PageTemplateRecipe
 *     partials[*]                         → PartialDesignRecipe
 *     layout.placeholders[*][*].componentHandle           → ComponentTemplateRecipe
 *     layout.placeholders[*][*].datasourceRef.handle      → ContentItemRecipe
 *
 *   SiteTemplateRecipe
 *     dictionaries[*]                     → DictionaryRecipe
 *
 *   DictionaryRecipe
 *     site                                → SiteRecipe
 *
 * Shared-site uniqueness: at most ONE SiteRecipe per collection (keyed
 * on collectionId / collectionName) may carry `siteRole: "shared"`.
 * Reported as a `FieldShapeError` on the first offender.
 *
 * Beyond reference resolution this also checks **placement legality** —
 * a layout placement into a recipe-defined placeholder whose
 * `Allowed Controls` whitelist doesn't include the component is reported
 * as a `PlacementViolation` — and flags a placeholder `key` declared by
 * more than one recipe.
 *
 * Cycle detection covers `insertOptions` chains
 * (`ComponentTemplate.insertOptions → ContentTemplate.insertOptions → …`)
 * — the only place the current schema permits transitive recipe-to-recipe
 * references that could loop. Partial-to-partial cycles aren't possible
 * today (`PartialDesignRecipe` doesn't reference other partials); if
 * sub-partial composition is ever added, extend the DFS below.
 */

export type RecipeKind = Recipe["kind"];

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

/**
 * A layout placement that drops a component into a recipe-defined
 * placeholder whose `Allowed Controls` whitelist doesn't include it —
 * the "what's allowed in a placeholder" enforcement.
 *
 * Only raised for placeholders the recipe set itself defines (a
 * `PlaceholderRecipe` or an inline `ComponentTemplateRecipe.placeholders`
 * slot) AND that carry a non-empty whitelist. Placements into
 * pre-existing tenant placeholders, or into recipe-defined placeholders
 * with an empty (unrestricted) whitelist, are not checkable here and
 * pass.
 */
export interface PlacementViolation {
  /** Handle of the recipe that holds the offending layout. */
  fromRecipe: string;
  /** Dotted path to the placement — `layout.placeholders./header.0`. */
  fromField: string;
  /** The component handle being placed. */
  componentHandle: string;
  /** The placeholder key it was placed into. */
  placeholderKey: string;
  /** The component handles the placeholder's whitelist does allow. */
  allowedComponents: readonly string[];
}

export interface ValidationResult {
  unresolvedHandles: UnresolvedHandle[];
  duplicateHandles: DuplicateHandle[];
  cycles: CyclicReference[];
  fieldShapeErrors: FieldShapeError[];
  placementViolations: PlacementViolation[];
}

export const isValid = (result: ValidationResult): boolean =>
  result.unresolvedHandles.length === 0 &&
  result.duplicateHandles.length === 0 &&
  result.cycles.length === 0 &&
  result.fieldShapeErrors.length === 0 &&
  result.placementViolations.length === 0;

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
  for (const v of result.placementViolations) {
    lines.push(
      `${v.fromRecipe} → ${v.fromField}: '${v.componentHandle}' is not allowed in placeholder '${v.placeholderKey}' (allowed: ${v.allowedComponents.join(", ") || "none"}).`
    );
  }
  return lines.join("\n");
}

/**
 * Records an unresolved/wrong-kind handle reference. Closes over the
 * recipe index + the `unresolved` accumulator inside `validateRecipeSet`.
 */
type CheckRef = (
  fromRecipe: string,
  fromField: string,
  handle: string,
  expectedKinds: readonly RecipeKind[]
) => void;

/**
 * Records placement-legality violations for a layout's placeholders.
 * Closes over the placeholder allow-set + the `placementViolations`
 * accumulator inside `validateRecipeSet`.
 */
type CheckLayout = (
  fromRecipe: string,
  placeholders: Record<string, ReadonlyArray<{ componentHandle: string }>>
) => void;

/**
 * Reference-check every outbound handle a recipe carries.
 *
 * The reference inventory comes from the shared `recipeReferences()`
 * accessor (`./references`) — the same one the apply-ordering topo-sort
 * consumes, so the two never drift. Each reference tagged with
 * `expectedKinds` is resolved + kind-checked; references without
 * `expectedKinds` are topo-sort-only (today only a variant's
 * `targetRendering.handle`) and skipped, preserving the pre-refactor
 * behavior where `validate.ts` had no `case "variant"`.
 */
const checkRecipeHandleReferences = (recipe: Recipe, checkRef: CheckRef): void => {
  for (const ref of recipeReferences(recipe)) {
    if (ref.expectedKinds === undefined) continue;
    checkRef(recipe.handle, ref.field, ref.handle, ref.expectedKinds);
  }
};

/**
 * Kind-specific shape constraints Zod can't enforce — emitted as
 * `FieldShapeError`s rather than handle-resolution failures. These are
 * NOT cross-recipe references, so they stay out of `recipeReferences()`.
 *
 *   - component-template: external `parameters` + `dynamicPlaceholders`
 *     are mutually exclusive (the IDynamicPlaceholder base must chain
 *     onto the consumer's OWN params template).
 *   - site: `collectionId` XOR `collectionName` (discriminated-union
 *     members can't carry a `.refine()`).
 */
const checkRecipeShapeErrors = (recipe: Recipe, fieldShapeErrors: FieldShapeError[]): void => {
  if (recipe.kind === "component-template") {
    if (recipe.parameters && recipe.dynamicPlaceholders) {
      fieldShapeErrors.push({
        fromRecipe: recipe.handle,
        fromField: "parameters",
        message:
          "Cannot combine external 'parameters' with 'dynamicPlaceholders: true'. The IDynamicPlaceholder base must chain onto the consumer's own params template; chaining it onto a shared external template would silently affect every other consumer. Inline the params via 'params:' or drop 'dynamicPlaceholders'.",
      });
    }
    return;
  }
  if (recipe.kind === "site") {
    if (recipe.collectionId && recipe.collectionName) {
      fieldShapeErrors.push({
        fromRecipe: recipe.handle,
        fromField: "collectionId, collectionName",
        message: "collectionId and collectionName are mutually exclusive — provide one, not both",
      });
    }
    if (!recipe.collectionId && !recipe.collectionName) {
      fieldShapeErrors.push({
        fromRecipe: recipe.handle,
        fromField: "collectionId, collectionName",
        message: "either collectionId (existing) or collectionName (new) must be provided",
      });
    }
  }
};

/** The layout a recipe carries for placement-legality checks, if any. */
const layoutPlaceholdersOf = (
  recipe: Recipe
): Record<string, ReadonlyArray<{ componentHandle: string }>> | undefined => {
  switch (recipe.kind) {
    case "partial-design":
      return recipe.layout.placeholders;
    case "page":
    case "page-design":
    case "page-template":
      return recipe.layout?.placeholders;
    default:
      return undefined;
  }
};

/**
 * Run all per-recipe checks: cross-recipe handle resolution (shared
 * inventory), Zod-inexpressible shape constraints, and placement
 * legality. Pure routing — accumulation happens through the passed-in
 * closures and error arrays.
 */
const checkRecipe = (
  recipe: Recipe,
  checkRef: CheckRef,
  checkLayoutPlacements: CheckLayout,
  fieldShapeErrors: FieldShapeError[]
): void => {
  checkRecipeHandleReferences(recipe, checkRef);
  checkRecipeShapeErrors(recipe, fieldShapeErrors);
  const placeholders = layoutPlaceholdersOf(recipe);
  if (placeholders) checkLayoutPlacements(recipe.handle, placeholders);
};

/**
 * Build the recipe handle index + duplicate-handle report. The index
 * keeps the FIRST recipe seen per handle (matching the pre-refactor
 * `if (!index.has(...))` guard); counts drive duplicate detection.
 */
const buildRecipeIndex = (
  recipes: readonly Recipe[]
): { index: Map<string, Recipe>; duplicateHandles: DuplicateHandle[] } => {
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
  return { index, duplicateHandles };
};

/**
 * Pre-pass building the placeholder allow-sets the legality check uses.
 * Collects standalone `PlaceholderRecipe` + inline
 * `ComponentTemplateRecipe.placeholders` declarations, folds in
 * `placedIn` contributions, and flags any key declared by 2+ recipes.
 * Mirrors `buildPlaceholderSettingsAggregate` in `compile.ts`.
 */
const collectPlaceholderAllowSets = (
  recipes: readonly Recipe[],
  fieldShapeErrors: FieldShapeError[]
): Map<string, Set<string>> => {
  const placeholderAllow = new Map<string, Set<string>>();
  const placeholderDefiners = new Map<string, string[]>();
  const declarePlaceholder = (key: string, byRecipe: string): Set<string> => {
    placeholderDefiners.set(key, [...(placeholderDefiners.get(key) ?? []), byRecipe]);
    let set = placeholderAllow.get(key);
    if (!set) {
      set = new Set();
      placeholderAllow.set(key, set);
    }
    return set;
  };
  for (const recipe of recipes) {
    if (recipe.kind === "placeholder") {
      const set = declarePlaceholder(recipe.key, recipe.handle);
      for (const handle of recipe.allowedComponents ?? []) set.add(handle);
    } else if (recipe.kind === "component-template") {
      for (const slot of recipe.placeholders ?? []) {
        const set = declarePlaceholder(slot.key, recipe.handle);
        // Accept both `allowedComponents` (scai's historical name) and
        // `allowedRenderingHandles` (the registry-side alias) — see
        // resolveAllowedHandles in schema/recipe.ts.
        for (const handle of resolveAllowedHandles(slot)) set.add(handle);
      }
    }
  }
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    for (const key of recipe.placedIn ?? []) {
      placeholderAllow.get(key)?.add(recipe.handle);
    }
  }
  // A placeholder key declared by 2+ recipes is ambiguous — both would
  // derive the same Placeholder Settings item GUID. Flag it once.
  for (const [key, definers] of placeholderDefiners) {
    if (definers.length > 1) {
      fieldShapeErrors.push({
        fromRecipe: definers[0],
        fromField: "placeholder key",
        message: `placeholder key '${key}' is declared by multiple recipes (${definers.join(", ")}) — a key maps to exactly one Placeholder Settings item; declare it once.`,
      });
    }
  }
  return placeholderAllow;
};

/**
 * Shared-site uniqueness: at most ONE SiteRecipe with
 * `siteRole: "shared"` per collection. A second shared site under the
 * same collection would silently shadow the first in SXA's resolution
 * chain. Collection identity is `collectionId ?? collectionName` (the
 * two are XOR-enforced elsewhere); sites missing both are skipped here
 * to avoid stacking a confusing error on top of the XOR failure.
 */
const checkSharedSiteUniqueness = (
  recipes: readonly Recipe[],
  fieldShapeErrors: FieldShapeError[]
): void => {
  const sharedByCollection = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "site" || recipe.siteRole !== "shared") continue;
    const collectionKey = recipe.collectionId ?? recipe.collectionName;
    if (!collectionKey) continue;
    const bucket = sharedByCollection.get(collectionKey) ?? [];
    bucket.push(recipe.handle);
    sharedByCollection.set(collectionKey, bucket);
  }
  for (const [collectionKey, sharedHandles] of sharedByCollection) {
    if (sharedHandles.length > 1) {
      // Report once, on the first offender, listing every conflicting
      // recipe so the operator can pick which one to flip back to
      // `regular`.
      fieldShapeErrors.push({
        fromRecipe: sharedHandles[0],
        fromField: "siteRole",
        message: `collection '${collectionKey}' has ${sharedHandles.length} SiteRecipes with siteRole: 'shared' (${sharedHandles.join(", ")}). SXA's resolution chain allows at most ONE shared site per collection — pick one and flip the others to siteRole: 'regular'.`,
      });
    }
  }
};

/**
 * Validate cross-recipe references in a recipe set. Returns a result
 * with all detected problems — caller decides whether to throw, log,
 * or surface them in CLI output.
 */
export function validateRecipeSet(recipes: readonly Recipe[]): ValidationResult {
  const { index, duplicateHandles } = buildRecipeIndex(recipes);

  const unresolved: UnresolvedHandle[] = [];
  const fieldShapeErrors: FieldShapeError[] = [];

  const checkRef: CheckRef = (
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

  const placementViolations: PlacementViolation[] = [];

  // Pre-pass: collect recipe-defined placeholder keys and their resolved
  // `Allowed Controls` whitelists. Mirrors
  // `buildPlaceholderSettingsAggregate` in `compile.ts` so the legality
  // check sees the same allow-sets the compiler emits.
  const placeholderAllow = collectPlaceholderAllowSets(recipes, fieldShapeErrors);

  /**
   * Check every placement in a layout against the placeholder allow-set.
   * Only flags placements into recipe-defined placeholders with a
   * non-empty whitelist — pre-existing tenant placeholders and
   * unrestricted (empty-whitelist) ones can't be checked and pass.
   */
  const checkLayoutPlacements: CheckLayout = (fromRecipe, placeholders) => {
    for (const [phKey, placements] of Object.entries(placeholders)) {
      const allow = placeholderAllow.get(phKey);
      if (!allow || allow.size === 0) continue;
      placements.forEach((placement, idx) => {
        if (!allow.has(placement.componentHandle)) {
          placementViolations.push({
            fromRecipe,
            fromField: `layout.placeholders.${phKey}.${idx}`,
            componentHandle: placement.componentHandle,
            placeholderKey: phKey,
            allowedComponents: [...allow].sort((a, b) => a.localeCompare(b)),
          });
        }
      });
    }
  };

  for (const recipe of recipes) {
    checkRecipe(recipe, checkRef, checkLayoutPlacements, fieldShapeErrors);
  }

  checkSharedSiteUniqueness(recipes, fieldShapeErrors);

  const cycles = detectInsertOptionsCycles(index, recipes);

  return {
    unresolvedHandles: unresolved,
    duplicateHandles,
    cycles,
    fieldShapeErrors,
    placementViolations,
  };
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
