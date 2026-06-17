import { createScaiError } from "@/shared/errors";
import type { Recipe, SitecoreFieldAugment } from "./schema/recipe";
import { resolveAllowedHandles } from "./schema/recipe";

/**
 * The picker-scope handles to validate on a `SitecoreFieldAugment`.
 * Empty when the augment is absent OR uses the `raw` source mode
 * (verbatim Source string; nothing to resolve).
 */
const sourceTypesOf = (augment: SitecoreFieldAugment | undefined): readonly string[] => {
  if (augment?.source?.kind !== "filter") return [];
  return augment.source.types ?? [];
};

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

const TEMPLATE_KINDS: readonly RecipeKind[] = [
  "component-template",
  "content-template",
  "page-template",
];
const COMPONENT_TEMPLATE_KINDS: readonly RecipeKind[] = ["component-template"];
const CONTENT_TEMPLATE_KINDS: readonly RecipeKind[] = ["content-template"];
const PAGE_TEMPLATE_KINDS: readonly RecipeKind[] = ["page-template"];
const PAGE_KINDS: readonly RecipeKind[] = ["page"];
const CONTENT_ITEM_KINDS: readonly RecipeKind[] = ["content-item"];
const PARAMETERS_TEMPLATE_KINDS: readonly RecipeKind[] = ["design-parameters-template"];
const PARTIAL_DESIGN_KINDS: readonly RecipeKind[] = ["partial-design"];
const PAGE_DESIGN_KINDS: readonly RecipeKind[] = ["page-design"];
const SITE_TEMPLATE_KINDS: readonly RecipeKind[] = ["site-template"];
const SITE_KINDS: readonly RecipeKind[] = ["site"];
const DICTIONARY_KINDS: readonly RecipeKind[] = ["dictionary"];
const ANY_KINDS: readonly RecipeKind[] = [
  "component-template",
  "content-template",
  "content-item",
  "page-template",
  "page",
  "placeholder",
  "design-parameters-template",
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

/** A layout shape carrying placement placeholders, as on partial/page/design recipes. */
type LayoutWithPlaceholders = {
  placeholders: Record<
    string,
    ReadonlyArray<{
      componentHandle: string;
      datasourceRef?: { kind: "shared"; handle: string } | { kind: "scoped" } | { kind: "none" };
    }>
  >;
};

/**
 * Reference-check every placement in a layout: each `componentHandle`
 * must resolve to a ComponentTemplateRecipe, and each shared
 * `datasourceRef.handle` to a ContentItemRecipe. Shared by the four
 * layout-bearing recipe kinds (partial-design, page-design,
 * page-template, page).
 */
const checkLayoutPlacementRefs = (
  checkRef: CheckRef,
  fromRecipe: string,
  layout: LayoutWithPlaceholders
): void => {
  for (const [phKey, placements] of Object.entries(layout.placeholders)) {
    placements.forEach((placement, idx) => {
      checkRef(
        fromRecipe,
        `layout.placeholders.${phKey}.${idx}.componentHandle`,
        placement.componentHandle,
        COMPONENT_TEMPLATE_KINDS
      );
      if (placement.datasourceRef?.kind === "shared") {
        checkRef(
          fromRecipe,
          `layout.placeholders.${phKey}.${idx}.datasourceRef.handle`,
          placement.datasourceRef.handle,
          CONTENT_ITEM_KINDS
        );
      }
    });
  }
};

/** Reference-check a list of source-picker `types` on `field`/`param` augments. */
const checkSourceTypeRefs = (
  checkRef: CheckRef,
  fromRecipe: string,
  prefix: string,
  augmented: readonly { sitecore?: SitecoreFieldAugment }[],
  expectedKinds: readonly RecipeKind[]
): void => {
  augmented.forEach((entry, idx) => {
    sourceTypesOf(entry.sitecore).forEach((handle, sIdx) => {
      checkRef(fromRecipe, `${prefix}.${idx}.sitecore.source.types.${sIdx}`, handle, expectedKinds);
    });
  });
};

/** Validate a ComponentTemplateRecipe's cross-recipe references + shape constraints. */
const checkComponentTemplateRefs = (
  recipe: Extract<Recipe, { kind: "component-template" }>,
  checkRef: CheckRef,
  fieldShapeErrors: FieldShapeError[]
): void => {
  checkSourceTypeRefs(checkRef, recipe.handle, "fields", recipe.fields, TEMPLATE_KINDS);
  checkSourceTypeRefs(checkRef, recipe.handle, "params", recipe.params, TEMPLATE_KINDS);
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
    if (recipe.dynamicPlaceholders) {
      fieldShapeErrors.push({
        fromRecipe: recipe.handle,
        fromField: "parameters",
        message:
          "Cannot combine external 'parameters' with 'dynamicPlaceholders: true'. The IDynamicPlaceholder base must chain onto the consumer's own params template; chaining it onto a shared external template would silently affect every other consumer. Inline the params via 'params:' or drop 'dynamicPlaceholders'.",
      });
    }
  }
  recipe.children?.allowedHandles.forEach((handle, idx) => {
    checkRef(recipe.handle, `children.allowedHandles.${idx}`, handle, TEMPLATE_KINDS);
  });
  (recipe.placeholders ?? []).forEach((slot, idx) => {
    // Both `allowedComponents` and the registry-side alias
    // `allowedRenderingHandles` flow through `resolveAllowedHandles`;
    // reference-check the merged set so handles authored under either
    // name still validate.
    resolveAllowedHandles(slot).forEach((handle, aIdx) => {
      checkRef(
        recipe.handle,
        `placeholders.${idx}.allowedRenderingHandles.${aIdx}`,
        handle,
        COMPONENT_TEMPLATE_KINDS
      );
    });
  });
};

/** Validate a ContentItemRecipe's templateType + field cross-recipe references. */
const checkContentItemRefs = (
  recipe: Extract<Recipe, { kind: "content-item" }>,
  checkRef: CheckRef
): void => {
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
};

/** Validate a PageRecipe's template + loosely-typed field references. */
const checkPageRefs = (
  recipe: Extract<Recipe, { kind: "page" }>,
  checkRef: CheckRef,
  checkLayoutPlacements: CheckLayout
): void => {
  checkRef(recipe.handle, "template", recipe.template, PAGE_TEMPLATE_KINDS);
  // `PageRecipe.fields` is `Record<string, unknown>` (loose registry
  // shape alongside scai-native ContentFieldValue). Only scai-native
  // shapes carry cross-recipe handle refs; sniff `shape` defensively.
  for (const [fieldName, raw] of Object.entries(recipe.fields ?? {})) {
    if (raw === null || typeof raw !== "object" || !("shape" in raw)) continue;
    const value = raw as { shape: string; ref?: string; refs?: readonly string[] };
    if (value.shape === "link-internal" && typeof value.ref === "string") {
      checkRef(recipe.handle, `fields.${fieldName}.ref`, value.ref, ANY_KINDS);
    } else if (value.shape === "reference" && Array.isArray(value.refs)) {
      value.refs.forEach((handle: string, idx: number) => {
        checkRef(recipe.handle, `fields.${fieldName}.refs.${idx}`, handle, ANY_KINDS);
      });
    }
  }
  if (recipe.layout) {
    checkLayoutPlacementRefs(checkRef, recipe.handle, recipe.layout);
    checkLayoutPlacements(recipe.handle, recipe.layout.placeholders);
  }
};

/** Validate a SiteTemplateRecipe's template/design/dictionary/matrix references. */
const checkSiteTemplateRefs = (
  recipe: Extract<Recipe, { kind: "site-template" }>,
  checkRef: CheckRef
): void => {
  recipe.pageTemplates.forEach((handle, idx) => {
    checkRef(recipe.handle, `pageTemplates.${idx}`, handle, PAGE_TEMPLATE_KINDS);
  });
  recipe.pageDesigns.forEach((handle, idx) => {
    checkRef(recipe.handle, `pageDesigns.${idx}`, handle, PAGE_DESIGN_KINDS);
  });
  // `.default([])` on the schema only applies during Zod parse; test
  // fixtures that hand-construct Recipe objects can leave the field
  // undefined. Defensive `?? []` keeps it tolerant.
  (recipe.dictionaries ?? []).forEach((handle, idx) => {
    checkRef(recipe.handle, `dictionaries.${idx}`, handle, DICTIONARY_KINDS);
  });
  if (recipe.insertOptionsMatrix) {
    for (const [parentHandle, allowedChildren] of Object.entries(recipe.insertOptionsMatrix)) {
      // The KEY is itself a page-template handle. Validate it too — a
      // typo in the key would silently never apply at apply time.
      checkRef(
        recipe.handle,
        `insertOptionsMatrix.${parentHandle}`,
        parentHandle,
        PAGE_TEMPLATE_KINDS
      );
      allowedChildren.forEach((childHandle, idx) => {
        checkRef(
          recipe.handle,
          `insertOptionsMatrix.${parentHandle}.${idx}`,
          childHandle,
          PAGE_TEMPLATE_KINDS
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
        PAGE_TEMPLATE_KINDS
      );
      checkRef(
        recipe.handle,
        `templatesToDesigns.${templateHandle}`,
        designHandle,
        PAGE_DESIGN_KINDS
      );
    }
  }
};

/** Validate a SiteRecipe's references + collection-identity XOR shape. */
const checkSiteRefs = (
  recipe: Extract<Recipe, { kind: "site" }>,
  checkRef: CheckRef,
  fieldShapeErrors: FieldShapeError[]
): void => {
  checkRef(recipe.handle, "siteTemplate", recipe.siteTemplate, SITE_TEMPLATE_KINDS);
  if (recipe.initialHome !== undefined) {
    checkRef(recipe.handle, "initialHome", recipe.initialHome, PAGE_KINDS);
  }
  // Cross-field shape: SiteRecipe must specify exactly one of
  // collectionId or collectionName. The Zod schema can't enforce it
  // (discriminated union members can't carry refines), so it lives here.
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
};

/**
 * Dispatch one recipe to its kind-specific reference/shape checks.
 * Pure routing — all accumulation happens through the passed-in
 * `checkRef` / `checkLayoutPlacements` closures and the error arrays.
 */
const checkRecipeReferences = (
  recipe: Recipe,
  checkRef: CheckRef,
  checkLayoutPlacements: CheckLayout,
  fieldShapeErrors: FieldShapeError[]
): void => {
  switch (recipe.kind) {
    case "component-template":
      checkComponentTemplateRefs(recipe, checkRef, fieldShapeErrors);
      break;
    case "design-parameters-template":
      checkSourceTypeRefs(checkRef, recipe.handle, "params", recipe.params, TEMPLATE_KINDS);
      break;
    case "content-template":
      checkSourceTypeRefs(checkRef, recipe.handle, "fields", recipe.fields, TEMPLATE_KINDS);
      recipe.insertOptions?.forEach((handle, idx) => {
        checkRef(recipe.handle, `insertOptions.${idx}`, handle, TEMPLATE_KINDS);
      });
      break;
    case "content-item":
      checkContentItemRefs(recipe, checkRef);
      break;
    case "partial-design":
      checkLayoutPlacementRefs(checkRef, recipe.handle, recipe.layout);
      checkLayoutPlacements(recipe.handle, recipe.layout.placeholders);
      break;
    case "page-design":
      recipe.appliesTo.forEach((handle, idx) => {
        checkRef(recipe.handle, `appliesTo.${idx}`, handle, PAGE_TEMPLATE_KINDS);
      });
      recipe.partials.forEach((handle, idx) => {
        checkRef(recipe.handle, `partials.${idx}`, handle, PARTIAL_DESIGN_KINDS);
      });
      if (recipe.layout) {
        checkLayoutPlacementRefs(checkRef, recipe.handle, recipe.layout);
        checkLayoutPlacements(recipe.handle, recipe.layout.placeholders);
      }
      break;
    case "page-template":
      checkSourceTypeRefs(checkRef, recipe.handle, "fields", recipe.fields ?? [], TEMPLATE_KINDS);
      recipe.insertOptions?.forEach((handle, idx) => {
        checkRef(recipe.handle, `insertOptions.${idx}`, handle, PAGE_TEMPLATE_KINDS);
      });
      if (recipe.layout) {
        checkLayoutPlacementRefs(checkRef, recipe.handle, recipe.layout);
        checkLayoutPlacements(recipe.handle, recipe.layout.placeholders);
      }
      break;
    case "placeholder":
      (recipe.allowedComponents ?? []).forEach((handle, idx) => {
        checkRef(recipe.handle, `allowedComponents.${idx}`, handle, COMPONENT_TEMPLATE_KINDS);
      });
      break;
    case "page":
      checkPageRefs(recipe, checkRef, checkLayoutPlacements);
      break;
    case "site-template":
      checkSiteTemplateRefs(recipe, checkRef);
      break;
    case "site":
      checkSiteRefs(recipe, checkRef, fieldShapeErrors);
      break;
    case "dictionary":
      checkRef(recipe.handle, "site", recipe.site, SITE_KINDS);
      break;
  }
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
    checkRecipeReferences(recipe, checkRef, checkLayoutPlacements, fieldShapeErrors);
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
