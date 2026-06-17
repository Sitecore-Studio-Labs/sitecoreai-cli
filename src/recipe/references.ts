/**
 * Single source of truth for a recipe's **outbound cross-recipe handle
 * references** — the per-kind traversal that both the dependency
 * topo-sort (`compile/ordering.ts`) and the cross-recipe validator
 * (`validate.ts`) consume.
 *
 * Before this module the inventory was duplicated: `collectRecipeDeps`
 * (in `compile.ts`) switched on `recipe.kind` to pull handles for the
 * topo-sort, and the `check*Refs` family (in `validate.ts`) switched on
 * the SAME `recipe.kind` to reference-check the SAME handles. A new
 * reference site had to be added in both places in lockstep — a missed
 * edit silently reverted a recipe pair to alphabetic file-glob order
 * (topo-sort side) or skipped a dangling-handle check (validate side).
 *
 * `recipeReferences()` returns every outbound handle ONCE, tagged with:
 *
 *   - `handle`  — the referenced recipe handle. The topo-sort needs only
 *     this (which recipes must apply first).
 *   - `field`   — a dotted path into the recipe (`insertOptions.0`,
 *     `layout.placeholders./header.0.componentHandle`). The validator
 *     uses it verbatim as the `fromField` of an `UnresolvedHandle`, so
 *     the strings here must match the historical `check*Refs` paths
 *     exactly (asserted by `tests/unit/recipe/validate.test.ts`).
 *   - `expectedKinds` — the recipe kinds that are a legal resolution of
 *     this reference. PRESENT → the validator reference-checks it;
 *     ABSENT → the reference is topo-sort-only and the validator skips
 *     it. (Today only `VariantRecipe.targetRendering.handle` is
 *     topo-only: it seeds apply-ordering when a brand variant ships
 *     alongside its canonical component-template, but the canonical is
 *     usually absent from the set, so validating it would raise a
 *     spurious dangling-handle error. The pre-refactor `validate.ts`
 *     had no `case "variant"` — this preserves that.)
 */
import type { Recipe, SitecoreFieldAugment } from "./schema/recipe";
import { resolveAllowedHandles } from "./schema/recipe";

export type RecipeKind = Recipe["kind"];

/**
 * One outbound cross-recipe handle reference carried by a recipe.
 *
 * `expectedKinds` present ⇒ the validator resolves + kind-checks the
 * handle; absent ⇒ the reference exists only to order the apply
 * (topo-sort), and the validator leaves it alone.
 */
export interface RecipeReference {
  /** The referenced recipe handle. */
  handle: string;
  /** Dotted path into the source recipe — used as the validator's `fromField`. */
  field: string;
  /** Legal resolution kinds; absent ⇒ topo-sort-only, not validated. */
  expectedKinds?: readonly RecipeKind[];
}

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

/**
 * The picker-scope handles a `SitecoreFieldAugment` declares as source
 * `types`. Empty when the augment is absent OR uses the `raw` source
 * mode (verbatim Source string — nothing to resolve). The ONE copy of
 * this helper; both consumers (validate + ordering) reach it through
 * `recipeReferences`.
 */
export const sourceTypesOf = (augment: SitecoreFieldAugment | undefined): readonly string[] => {
  if (augment?.source?.kind !== "filter") return [];
  return augment.source.types ?? [];
};

/** A layout shape carrying placement placeholders (partial/page/design recipes). */
type LayoutWithPlaceholders = {
  placeholders: Record<
    string,
    ReadonlyArray<{
      componentHandle: string;
      datasourceRef?: { kind: "shared"; handle: string } | { kind: "scoped" } | { kind: "none" };
    }>
  >;
};

/** A list of augmented fields/params carrying source-picker `types`. */
type Augmented = readonly { sitecore?: SitecoreFieldAugment }[];

/** Push every source-picker `types` reference from an augmented field/param list. */
const pushSourceTypeRefs = (
  out: RecipeReference[],
  prefix: string,
  augmented: Augmented,
  expectedKinds: readonly RecipeKind[]
): void => {
  augmented.forEach((entry, idx) => {
    sourceTypesOf(entry.sitecore).forEach((handle, sIdx) => {
      out.push({ handle, field: `${prefix}.${idx}.sitecore.source.types.${sIdx}`, expectedKinds });
    });
  });
};

/** Push every layout-placement reference (componentHandle + shared datasourceRef). */
const pushLayoutPlacementRefs = (out: RecipeReference[], layout: LayoutWithPlaceholders): void => {
  for (const [phKey, placements] of Object.entries(layout.placeholders)) {
    placements.forEach((placement, idx) => {
      out.push({
        handle: placement.componentHandle,
        field: `layout.placeholders.${phKey}.${idx}.componentHandle`,
        expectedKinds: COMPONENT_TEMPLATE_KINDS,
      });
      if (placement.datasourceRef?.kind === "shared") {
        out.push({
          handle: placement.datasourceRef.handle,
          field: `layout.placeholders.${phKey}.${idx}.datasourceRef.handle`,
          expectedKinds: CONTENT_ITEM_KINDS,
        });
      }
    });
  }
};

const componentTemplateRefs = (
  recipe: Extract<Recipe, { kind: "component-template" }>,
  out: RecipeReference[]
): void => {
  // `?? []` guards hand-constructed fixtures that omit the (Zod-defaulted)
  // arrays — the topo-sort path feeds the same accessor.
  pushSourceTypeRefs(out, "fields", recipe.fields ?? [], TEMPLATE_KINDS);
  pushSourceTypeRefs(out, "params", recipe.params ?? [], TEMPLATE_KINDS);
  recipe.insertOptions?.forEach((handle, idx) => {
    out.push({ handle, field: `insertOptions.${idx}`, expectedKinds: TEMPLATE_KINDS });
  });
  if (recipe.datasource?.template) {
    out.push({
      handle: recipe.datasource.template.handle,
      field: "datasource.template.handle",
      expectedKinds: CONTENT_TEMPLATE_KINDS,
    });
  }
  if (recipe.parameters) {
    out.push({
      handle: recipe.parameters.handle,
      field: "parameters.handle",
      expectedKinds: PARAMETERS_TEMPLATE_KINDS,
    });
  }
  recipe.children?.allowedHandles.forEach((handle, idx) => {
    out.push({ handle, field: `children.allowedHandles.${idx}`, expectedKinds: TEMPLATE_KINDS });
  });
  (recipe.placeholders ?? []).forEach((slot, idx) => {
    // Both `allowedComponents` (scai's historical name) and the
    // registry-side alias `allowedRenderingHandles` flow through
    // `resolveAllowedHandles`; the field path is normalised to the
    // canonical `allowedRenderingHandles` name.
    resolveAllowedHandles(slot).forEach((handle, aIdx) => {
      out.push({
        handle,
        field: `placeholders.${idx}.allowedRenderingHandles.${aIdx}`,
        expectedKinds: COMPONENT_TEMPLATE_KINDS,
      });
    });
  });
};

const contentItemRefs = (
  recipe: Extract<Recipe, { kind: "content-item" }>,
  out: RecipeReference[]
): void => {
  out.push({ handle: recipe.templateType, field: "templateType", expectedKinds: TEMPLATE_KINDS });
  for (const [fieldName, value] of Object.entries(recipe.fields)) {
    if (value.shape === "link-internal") {
      out.push({ handle: value.ref, field: `fields.${fieldName}.ref`, expectedKinds: ANY_KINDS });
    } else if (value.shape === "reference") {
      value.refs.forEach((handle, idx) => {
        out.push({ handle, field: `fields.${fieldName}.refs.${idx}`, expectedKinds: ANY_KINDS });
      });
    }
  }
};

const pageRefs = (recipe: Extract<Recipe, { kind: "page" }>, out: RecipeReference[]): void => {
  out.push({ handle: recipe.template, field: "template", expectedKinds: PAGE_TEMPLATE_KINDS });
  // `PageRecipe.fields` is `Record<string, unknown>` (loose registry
  // shape alongside scai-native ContentFieldValue). Only scai-native
  // shapes carry cross-recipe handle refs; sniff `shape` defensively.
  for (const [fieldName, raw] of Object.entries(recipe.fields ?? {})) {
    if (raw === null || typeof raw !== "object" || !("shape" in raw)) continue;
    const value = raw as { shape: string; ref?: string; refs?: readonly string[] };
    if (value.shape === "link-internal" && typeof value.ref === "string") {
      out.push({ handle: value.ref, field: `fields.${fieldName}.ref`, expectedKinds: ANY_KINDS });
    } else if (value.shape === "reference" && Array.isArray(value.refs)) {
      value.refs.forEach((handle, idx) => {
        out.push({ handle, field: `fields.${fieldName}.refs.${idx}`, expectedKinds: ANY_KINDS });
      });
    }
  }
  if (recipe.layout) pushLayoutPlacementRefs(out, recipe.layout);
};

const siteTemplateRefs = (
  recipe: Extract<Recipe, { kind: "site-template" }>,
  out: RecipeReference[]
): void => {
  recipe.pageTemplates.forEach((handle, idx) => {
    out.push({ handle, field: `pageTemplates.${idx}`, expectedKinds: PAGE_TEMPLATE_KINDS });
  });
  recipe.pageDesigns.forEach((handle, idx) => {
    out.push({ handle, field: `pageDesigns.${idx}`, expectedKinds: PAGE_DESIGN_KINDS });
  });
  // `.default([])` only applies during Zod parse; hand-constructed test
  // fixtures may leave it undefined — defensive `?? []`.
  (recipe.dictionaries ?? []).forEach((handle, idx) => {
    out.push({ handle, field: `dictionaries.${idx}`, expectedKinds: DICTIONARY_KINDS });
  });
  if (recipe.insertOptionsMatrix) {
    for (const [parentHandle, allowedChildren] of Object.entries(recipe.insertOptionsMatrix)) {
      // The KEY is itself a page-template handle — a typo there would
      // silently never apply at apply time, so validate it too.
      out.push({
        handle: parentHandle,
        field: `insertOptionsMatrix.${parentHandle}`,
        expectedKinds: PAGE_TEMPLATE_KINDS,
      });
      allowedChildren.forEach((childHandle, idx) => {
        out.push({
          handle: childHandle,
          field: `insertOptionsMatrix.${parentHandle}.${idx}`,
          expectedKinds: PAGE_TEMPLATE_KINDS,
        });
      });
    }
  }
  if (recipe.templatesToDesigns) {
    for (const [templateHandle, designHandle] of Object.entries(recipe.templatesToDesigns)) {
      out.push({
        handle: templateHandle,
        field: `templatesToDesigns.${templateHandle} (key)`,
        expectedKinds: PAGE_TEMPLATE_KINDS,
      });
      out.push({
        handle: designHandle,
        field: `templatesToDesigns.${templateHandle}`,
        expectedKinds: PAGE_DESIGN_KINDS,
      });
    }
  }
};

/**
 * Enumerate every outbound cross-recipe handle reference a recipe
 * carries, tagged with its dotted field path and (when the reference is
 * validated) its legal resolution kinds.
 *
 * Pure per-kind routing. The single source of truth for the reference
 * inventory that both the apply-ordering topo-sort and the cross-recipe
 * validator consume — extend HERE when a new reference site is added.
 */
export function recipeReferences(recipe: Recipe): readonly RecipeReference[] {
  const out: RecipeReference[] = [];
  switch (recipe.kind) {
    case "component-template":
      componentTemplateRefs(recipe, out);
      break;
    case "content-template":
      pushSourceTypeRefs(out, "fields", recipe.fields ?? [], TEMPLATE_KINDS);
      recipe.insertOptions?.forEach((handle, idx) => {
        out.push({ handle, field: `insertOptions.${idx}`, expectedKinds: TEMPLATE_KINDS });
      });
      break;
    case "design-parameters-template":
      pushSourceTypeRefs(out, "params", recipe.params ?? [], TEMPLATE_KINDS);
      break;
    case "content-item":
      contentItemRefs(recipe, out);
      break;
    case "page-template":
      pushSourceTypeRefs(out, "fields", recipe.fields ?? [], TEMPLATE_KINDS);
      recipe.insertOptions?.forEach((handle, idx) => {
        out.push({ handle, field: `insertOptions.${idx}`, expectedKinds: PAGE_TEMPLATE_KINDS });
      });
      if (recipe.layout) pushLayoutPlacementRefs(out, recipe.layout);
      break;
    case "page":
      pageRefs(recipe, out);
      break;
    case "partial-design":
      pushLayoutPlacementRefs(out, recipe.layout);
      break;
    case "page-design":
      recipe.appliesTo.forEach((handle, idx) => {
        out.push({ handle, field: `appliesTo.${idx}`, expectedKinds: PAGE_TEMPLATE_KINDS });
      });
      recipe.partials.forEach((handle, idx) => {
        out.push({ handle, field: `partials.${idx}`, expectedKinds: PARTIAL_DESIGN_KINDS });
      });
      if (recipe.layout) pushLayoutPlacementRefs(out, recipe.layout);
      break;
    case "placeholder":
      (recipe.allowedComponents ?? []).forEach((handle, idx) => {
        out.push({
          handle,
          field: `allowedComponents.${idx}`,
          expectedKinds: COMPONENT_TEMPLATE_KINDS,
        });
      });
      break;
    case "site-template":
      siteTemplateRefs(recipe, out);
      break;
    case "site":
      out.push({
        handle: recipe.siteTemplate,
        field: "siteTemplate",
        expectedKinds: SITE_TEMPLATE_KINDS,
      });
      if (recipe.initialHome !== undefined) {
        out.push({ handle: recipe.initialHome, field: "initialHome", expectedKinds: PAGE_KINDS });
      }
      break;
    case "dictionary":
      out.push({ handle: recipe.site, field: "site", expectedKinds: SITE_KINDS });
      break;
    case "variant":
      // Brand-scoped sidecar variant — depends on its canonical
      // ComponentTemplateRecipe so the topo-sort runs it after the
      // canonical (when both happen to be in the same set). Topo-only:
      // the canonical is usually installed separately, so the edge has
      // no in-set referent and validating it would raise a spurious
      // dangling-handle error. `expectedKinds` omitted ⇒ not validated.
      out.push({ handle: recipe.targetRendering.handle, field: "targetRendering.handle" });
      break;
    case "component-section":
    case "enumeration":
    case "workflow":
    case "webhook-authorization":
      // Pure definitions — no outbound recipe refs in the authored shape.
      break;
  }
  return out;
}
