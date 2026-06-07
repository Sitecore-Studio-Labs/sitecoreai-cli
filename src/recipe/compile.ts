import { createScaiError } from "@/shared/errors";
import {
  availableRenderingsSectionId,
  enumerationFolderId,
  enumerationsRootId,
  enumerationsRootStandardValuesId,
  PAGE_DESIGNS_ROOT_REF_KEY,
  pageDesignId,
  placeholderSettingsFolderId,
  placeholderSettingsId,
  renderingId,
  renderingsSectionFolderId,
  sectionFolderId,
  sharedDataFolderStandardValuesId,
  sharedDataFolderTemplateId,
  siteDataFolderTemplateId,
  siteDataRootStandardValuesId,
  templateId,
} from "./items/guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type PruneChildrenOp,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "./ir/operations";
import { defaultPolicyForRecipe, policyFor } from "./runtime/policy";
import {
  AVAILABLE_RENDERINGS_FIELDS,
  COMPOSITION_FIELDS,
  DEFAULT_ICON,
  ENUMERATION_ICON,
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_SETTINGS_FOLDER_TEMPLATE_ID,
  PLACEHOLDER_TEMPLATE_ID,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
} from "./ir/sitecore-templates";
import {
  type Recipe,
  RecipeSchema,
  resolveAllowedHandles,
  type SitecoreFieldAugment,
} from "./schema/recipe";
import { encodeTemplatesMapping } from "./layout/templates-mapping";

import { compileComponentSectionRecipe } from "./compile/component-section";
import { compileComponentTemplateRecipe } from "./compile/component-template";
import { compileContentTemplateRecipe } from "./compile/content-template";
import { compileDesignParametersTemplateRecipe } from "./compile/design-parameters-template";
import { compilePartialDesignRecipe } from "./compile/partial-design";
import { compilePageDesignRecipe } from "./compile/page-design";
import { compilePageTemplateRecipe } from "./compile/page-template";
import { compilePageRecipe } from "./compile/page";
import { compilePlaceholderRecipe } from "./compile/placeholder";
import { compileContentItemRecipe } from "./compile/content-item";
import { compileSiteTemplateRecipe } from "./compile/site-template";
import { compileSiteRecipe } from "./compile/site";
import { compileDictionaryRecipe } from "./compile/dictionary";
import { compileEnumerationRecipe } from "./compile/enumeration";
import { compileWorkflowRecipe } from "./compile/workflow";
import { compileWebhookAuthorizationRecipe } from "./compile/webhook-authorization";
import { compileVariantRecipe } from "./compile/variant";
import {
  joinPath,
  sharedField,
  siteOf,
  versionedField,
  type CompileContext,
} from "./compile/shared";

// Re-export per-kind compile functions so existing import paths
// (`import { compileComponentTemplateRecipe } from "@/recipe/compile"`)
// keep working.
export {
  compileComponentSectionRecipe,
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  compileDesignParametersTemplateRecipe,
  compilePartialDesignRecipe,
  compilePageDesignRecipe,
  compilePageTemplateRecipe,
  compilePageRecipe,
  compilePlaceholderRecipe,
  compileContentItemRecipe,
  compileSiteTemplateRecipe,
  compileSiteRecipe,
  compileDictionaryRecipe,
  compileEnumerationRecipe,
  compileWorkflowRecipe,
  compileWebhookAuthorizationRecipe,
  compileVariantRecipe,
};

// Re-export the CompileContext type so callers can keep importing it
// from `@/recipe/compile` without reaching into the new sub-directory.
export type { CompileContext } from "./compile/shared";

/**
 * ## `__name__` aggregate-handle convention
 *
 * Every synthetic IR `compileRecipeSet` emits at the *cross-recipe*
 * layer (i.e. not produced by any single author-defined recipe) uses
 * a handle wrapped in double underscores: `__templates-mapping__`,
 * `__available-renderings__`, `__placeholder-settings__`, etc.
 *
 * The convention is load-bearing:
 *   - **Author-handle collision is impossible** — recipe handles match
 *     `[a-z][a-z0-9-]*@\d+` (validated by `HandleString` in
 *     `schema/recipe.ts`), so leading underscores are unrepresentable
 *     in author input. `__foo__` is reserved for the compiler.
 *   - **Plan / push output greps cleanly** — anything matching `__.*__`
 *     in a recipe-set summary is a synthesized aggregate, not a real
 *     recipe-author intent. Distinguishes "this is the cross-recipe
 *     dispatcher reporting" from "this is your recipe being applied."
 *   - **Apply-rank scheduling is uniform** — synthesized aggregates
 *     get explicit rank slots (see `RECIPE_APPLY_RANK` further down)
 *     so they run between rank tiers, not interleaved with author
 *     recipes.
 *
 * Adding a new aggregate? Export the handle as
 * `<NAME>_AGGREGATE_HANDLE = "__<kebab-name>__"` next to the others
 * below, doc-comment the emission semantics, and pick its
 * `RECIPE_APPLY_RANK` slot deliberately.
 */
export const TEMPLATES_MAPPING_AGGREGATE_HANDLE = "__templates-mapping__";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to
 * materialise the per-section `Available Renderings` items. Same
 * compiler-synthesized convention as `TEMPLATES_MAPPING_AGGREGATE_HANDLE`.
 */
export const AVAILABLE_RENDERINGS_AGGREGATE_HANDLE = "__available-renderings__";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to
 * materialise SHARED Data Folder templates — one per `(site, subfolder)`
 * targeted by ≥2 component-template recipes in the set. Each shared
 * template's `__Standard Values` Insert Options is the union of every
 * contributing recipe's datasource template, so a CMS author
 * right-clicking → Insert in (e.g.) `Site Shared UI/Badges` sees the
 * full set of legitimately-allowed shapes (Badge + StatusPill + Tag).
 *
 * Same `__…__` compiler-synthesized convention as the other aggregate
 * handles in this file.
 */
export const SHARED_DATA_FOLDERS_AGGREGATE_HANDLE = "__shared-data-folders__";

/**
 * Stable handle for the synthetic IR carrying the SHARED Data Folder
 * templates' Insert Options `SetField` ops.
 *
 * Split out from `SHARED_DATA_FOLDERS_AGGREGATE_HANDLE` (which now
 * carries ONLY the template/SV/base-template creation) because the two
 * halves have opposite ordering requirements relative to the per-recipe
 * IRs:
 *
 *   - Template creation must run BEFORE the per-recipe IRs — each
 *     recipe's `site-data-folder:<site>:<subfolder>` folder ITEM is
 *     created with `templateOf = sharedDataFolderTemplateId(...)`, so
 *     the template must already exist on the tenant (Authoring GraphQL
 *     rejects a createItem whose template GUID is unknown). Emitted at
 *     the FRONT of the IR list.
 *   - Insert Options must run AFTER the per-recipe IRs — the SetField's
 *     `ref-recipe-list` references each contributing recipe's datasource
 *     template (`templateId(site, handle)`), which the per-recipe IRs
 *     create. Emitted near the end of the IR list.
 *
 * Keeping both in one IR (the pre-fix shape) made the second
 * requirement win and the first lose: the shared template landed after
 * the folder items that referenced it, so the push aborted with
 * "Cannot find a template with the <id> id" — which then rolled back
 * the owning recipe and cascaded to every sibling sharing the section's
 * Presentation Parameters bucket.
 */
export const SHARED_DATA_FOLDER_INSERT_OPTIONS_AGGREGATE_HANDLE =
  "__shared-data-folder-insert-options__";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to
 * materialise the site Data folder ROOT's `__Standard Values` item +
 * Insert Options aggregate. The SV restricts right-click → Insert at
 * `<contentItemsRoot>` to: the generic Folder template, every
 * per-recipe `<Component> Data Folder` template (singletons), and
 * every shared `<subfolder> Data Folder` template (coalesced shared
 * subfolders).
 *
 * Same `__…__` compiler-synthesized convention as the other aggregate
 * handles in this file.
 */
export const SITE_DATA_ROOT_AGGREGATE_HANDLE = "__site-data-root__";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to
 * materialise the enumerations root's `__Standard Values` item +
 * Insert Options aggregate. The SV restricts right-click → Insert at
 * `<enumerationsRoot>` to: the generic Folder template, plus every
 * per-recipe enumeration folder template (which is the per-site
 * `Enumerations Folder` template — but the aggregate lists each
 * `enumerationFolderId(site, handle)` so the shape mirrors the site
 * data root aggregator and stays consistent if we ever introduce
 * per-recipe enumeration folder templates).
 */
export const ENUMERATIONS_ROOT_AGGREGATE_HANDLE = "__enumerations-root__";

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to
 * materialise the Placeholder Settings items — one per unique
 * placeholder key declared anywhere in the set (a `PlaceholderRecipe`
 * or an inline `ComponentTemplateRecipe.placeholders` slot). Each key's
 * `Allowed Controls` whitelist is the union of slot-side
 * `allowedComponents` and every component naming the key in `placedIn`.
 *
 * Same `__…__` compiler-synthesized convention as the other aggregate
 * handles in this file.
 */
export const PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE = "__placeholder-settings__";

/**
 * Stable handle for the synthetic IR that materialises subtree-level
 * ownership for `ComponentSectionRecipe`s whose `ownership.mode` is
 * `"exclusive"`. Per exclusively-owned section the aggregate emits
 * `PruneChildren` ops for BOTH:
 *
 *   - The RENDERINGS section folder (`<renderingsRoot>/<section.name>`)
 *     — prunes any rendering item the recipe set didn't produce.
 *     `templateFilter: [RENDERING]` ensures only items conforming to
 *     SXA Rendering get pruned — co-located non-rendering items stay.
 *
 *   - The TEMPLATES section folder (`<componentsRoot>/<section.name>`)
 *     — prunes any component-template item the recipe set didn't
 *     produce. `templateFilter: [TEMPLATE]` restricts the prune to
 *     items conforming to the SXA Template meta-template, so the
 *     "Component Folders" and "Presentation Parameters" bucket folders
 *     (`templateOf: TEMPLATE_FOLDER`) are skipped — those are
 *     compiler-managed scaffolding, not author-facing content.
 *
 * NOT pruned by this aggregate: the SXA Headless Variants tree. SXA
 * stores per-rendering variant folders FLAT under
 * `<headlessVariantsRoot>/<RenderingName>`, not under a per-section
 * subfolder — so a section-scoped ownership declaration can't safely
 * address them (it would have to reach across sections). A site-level
 * variants ownership concept could land later; until then, orphan
 * variant folders for retired renderings stay put and need manual
 * cleanup or a hand-authored PruneChildren op.
 *
 * Same `__…__` compiler-synthesized convention as the other aggregate
 * handles in this file.
 */
export const COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE = "__component-section-ownership__";

/**
 * Cross-recipe apply-ordering rank, by recipe kind. `compileRecipeSet`
 * stably sorts per-recipe IRs by this rank so every recipe is applied
 * after the definitions it references:
 *
 *   0  definitions — templates, sections, enums, workflows: referenced
 *      by everything, reference nothing cross-recipe forward.
 *   1  content items + placeholders — reference rank-0 templates.
 *   2  partial designs — place components, bind shared content items.
 *   3  page designs + pages — reference page templates, partials,
 *      content items.
 *   4  site templates — reference page templates + page designs.
 *   5  sites — instance a site template, point at an initial page.
 *
 * The rank is coarse — it orders ACROSS kinds, not within. Intra-rank
 * forward references (e.g. one component's `insertOptions` naming
 * another) still rely on the executor's `crossRecipeRefs` path seeding.
 */
const RECIPE_APPLY_RANK: Record<Recipe["kind"], number> = {
  "component-section": 0,
  "component-template": 0,
  "content-template": 0,
  "page-template": 0,
  "design-parameters-template": 0,
  enumeration: 0,
  workflow: 0,
  "webhook-authorization": 0,
  "content-item": 1,
  placeholder: 1,
  // Brand variants attach to existing component-templates (rank 0).
  // Rank 1 keeps them after the canonical in the same set — and, when
  // installed standalone (the common case), still respects layering
  // against any composition-level recipes shipped alongside.
  variant: 1,
  "partial-design": 2,
  "page-design": 3,
  page: 3,
  "site-template": 4,
  // Sites must materialise before dictionaries — a DictionaryRecipe's
  // items land under `<site>/Dictionary/<name>` and the site's content
  // tree has to exist first.
  site: 5,
  dictionary: 6,
};

const sourceTypesOfAugment = (augment: SitecoreFieldAugment | undefined): readonly string[] => {
  if (augment?.source?.kind !== "filter") return [];
  return augment.source.types ?? [];
};

/**
 * Enumerate every cross-recipe handle reference a recipe carries.
 *
 * Mirrors `validate.ts`'s reference inventory but RETURNS the set
 * rather than checking it — used by `stableTopologicalSortWithinRanks`
 * below to order recipes within an apply-rank so referenced
 * recipes always push before recipes that point at them. (Validation
 * already runs separately and asserts every handle resolves to an
 * extant recipe of the right kind; this extractor assumes input has
 * already been validated and doesn't re-check.)
 *
 * Keep in sync with the inventory in `validate.ts` whenever a new
 * cross-recipe reference site is added — a forgotten reference
 * silently reverts to alphabetic file-glob order for the affected
 * recipe pair, which manifests as "ref-source-fields … not yet in
 * captured map" at first push.
 */
const extractRecipeDependencies = (recipe: Recipe): readonly string[] => {
  const deps = new Set<string>();
  const add = (h: string | undefined) => {
    if (h && h !== recipe.handle) deps.add(h);
  };
  switch (recipe.kind) {
    case "component-template":
      for (const f of recipe.fields ?? []) sourceTypesOfAugment(f.sitecore).forEach(add);
      for (const p of recipe.params ?? []) sourceTypesOfAugment(p.sitecore).forEach(add);
      recipe.insertOptions?.forEach(add);
      add(recipe.datasource?.template?.handle);
      add(recipe.parameters?.handle);
      recipe.children?.allowedHandles.forEach(add);
      for (const slot of recipe.placeholders ?? []) {
        resolveAllowedHandles(slot).forEach(add);
      }
      break;
    case "content-template":
      for (const f of recipe.fields ?? []) sourceTypesOfAugment(f.sitecore).forEach(add);
      recipe.insertOptions?.forEach(add);
      break;
    case "design-parameters-template":
      for (const p of recipe.params ?? []) sourceTypesOfAugment(p.sitecore).forEach(add);
      break;
    case "content-item":
      add(recipe.templateType);
      for (const v of Object.values(recipe.fields)) {
        if (v.shape === "link-internal") add(v.ref);
        else if (v.shape === "reference") v.refs.forEach(add);
      }
      break;
    case "page-template":
      for (const f of recipe.fields ?? []) sourceTypesOfAugment(f.sitecore).forEach(add);
      recipe.insertOptions?.forEach(add);
      if (recipe.layout) {
        for (const placements of Object.values(recipe.layout.placeholders)) {
          for (const p of placements) {
            add(p.componentHandle);
            if (p.datasourceRef?.kind === "shared") add(p.datasourceRef.handle);
          }
        }
      }
      break;
    case "page":
      add(recipe.template);
      // `PageRecipe.fields` is `Record<string, unknown>` (loose registry
      // shape + scai-native ContentFieldValue). Only scai-native shapes
      // carry cross-recipe handle refs; sniff `shape` defensively.
      for (const v of Object.values(recipe.fields ?? {})) {
        if (v !== null && typeof v === "object" && "shape" in v) {
          const sv = v as { shape: string; ref?: string; refs?: readonly string[] };
          if (sv.shape === "link-internal" && typeof sv.ref === "string") add(sv.ref);
          else if (sv.shape === "reference" && Array.isArray(sv.refs)) sv.refs.forEach(add);
        }
      }
      if (recipe.layout) {
        for (const placements of Object.values(recipe.layout.placeholders)) {
          for (const p of placements) {
            add(p.componentHandle);
            if (p.datasourceRef?.kind === "shared") add(p.datasourceRef.handle);
          }
        }
      }
      break;
    case "partial-design":
      for (const placements of Object.values(recipe.layout.placeholders)) {
        for (const p of placements) {
          add(p.componentHandle);
          if (p.datasourceRef?.kind === "shared") add(p.datasourceRef.handle);
        }
      }
      break;
    case "page-design":
      recipe.appliesTo.forEach(add);
      recipe.partials.forEach(add);
      if (recipe.layout) {
        for (const placements of Object.values(recipe.layout.placeholders)) {
          for (const p of placements) {
            add(p.componentHandle);
            if (p.datasourceRef?.kind === "shared") add(p.datasourceRef.handle);
          }
        }
      }
      break;
    case "placeholder":
      (recipe.allowedComponents ?? []).forEach(add);
      break;
    case "site-template":
      recipe.pageTemplates.forEach(add);
      recipe.pageDesigns.forEach(add);
      (recipe.dictionaries ?? []).forEach(add);
      if (recipe.insertOptionsMatrix) {
        for (const [parent, children] of Object.entries(recipe.insertOptionsMatrix)) {
          add(parent);
          children.forEach(add);
        }
      }
      if (recipe.templatesToDesigns) {
        for (const [tplHandle, designHandle] of Object.entries(recipe.templatesToDesigns)) {
          add(tplHandle);
          add(designHandle);
        }
      }
      break;
    case "site":
      add(recipe.siteTemplate);
      if (recipe.initialHome !== undefined) add(recipe.initialHome);
      break;
    case "dictionary":
      add(recipe.site);
      break;
    case "variant":
      // Brand-scoped sidecar variant — depends on its canonical
      // ComponentTemplateRecipe so the topo sort runs it after the
      // canonical (when both happen to be in the same recipe set).
      // In typical brand-variant installs the canonical isn't in
      // this set; the dependency edge then has no in-set referent
      // and the topo sort treats it as a leaf.
      add(recipe.targetRendering.handle);
      break;
    case "component-section":
    case "enumeration":
    case "workflow":
    case "webhook-authorization":
      // Pure definitions — no outbound recipe refs in the authored shape.
      break;
  }
  return [...deps];
};

/**
 * Order recipes by apply-rank, then topologically by intra-rank
 * cross-recipe dependencies. Producer recipes push before the
 * recipes that reference them.
 *
 * Algorithm: Kahn's topological sort restricted to within-rank edges,
 * tie-broken by original input index so unrelated recipes keep their
 * file-glob order. Cross-rank dependencies are handled by the coarse
 * rank already — within-rank topology only matters when two recipes
 * of the same kind reference each other (the common case is a
 * component-template referencing a content-template at rank 0; both
 * sort to rank 0 and need intra-rank ordering).
 *
 * Cycles within a rank are not expected — `validateRecipeSet`'s cycle
 * detector catches `insertOptions` chains, and other cross-recipe
 * graphs are acyclic by schema construction. If a cycle does slip
 * through (defensive), the algorithm preserves input order for the
 * cyclic subset and emits all remaining recipes after, so push still
 * runs in a deterministic order rather than throwing here.
 */
const stableTopologicalSortWithinRanks = (recipes: readonly Recipe[]): readonly Recipe[] => {
  // Group by rank, preserving input order within each group.
  const groups = new Map<number, Recipe[]>();
  for (const r of recipes) {
    const rank = RECIPE_APPLY_RANK[r.kind];
    let bucket = groups.get(rank);
    if (!bucket) {
      bucket = [];
      groups.set(rank, bucket);
    }
    bucket.push(r);
  }
  const out: Recipe[] = [];
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(rank)!;
    if (group.length <= 1) {
      out.push(...group);
      continue;
    }
    // Build dep graph: handle → set of in-group dep handles.
    const handleToIndex = new Map<string, number>();
    group.forEach((r, idx) => handleToIndex.set(r.handle, idx));
    const inDegree = new Array<number>(group.length).fill(0);
    const adjacency: number[][] = group.map(() => []);
    for (let i = 0; i < group.length; i++) {
      for (const depHandle of extractRecipeDependencies(group[i])) {
        const depIdx = handleToIndex.get(depHandle);
        if (depIdx === undefined || depIdx === i) continue;
        adjacency[depIdx].push(i);
        inDegree[i]++;
      }
    }
    // Kahn's algorithm with stable tie-break by original index.
    const ready: number[] = [];
    for (let i = 0; i < group.length; i++) if (inDegree[i] === 0) ready.push(i);
    const sorted: Recipe[] = [];
    while (ready.length > 0) {
      ready.sort((a, b) => a - b);
      const idx = ready.shift()!;
      sorted.push(group[idx]);
      for (const next of adjacency[idx]) {
        inDegree[next]--;
        if (inDegree[next] === 0) ready.push(next);
      }
    }
    // Defensive: append any cycle survivors in input order.
    if (sorted.length < group.length) {
      const placed = new Set(sorted.map((r) => r.handle));
      for (const r of group) if (!placed.has(r.handle)) sorted.push(r);
    }
    out.push(...sorted);
  }
  return out;
};

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

  // Build the section handle → recipe map so we can resolve component
  // recipes' `section.handle` references to section names (and pick up
  // each section's `displayName` for the toolbox label).
  const sectionsByHandle = new Map<string, import("./schema/recipe").ComponentSectionRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind === "component-section") {
      sectionsByHandle.set(recipe.handle, recipe);
    }
  }

  // Group component-template recipes by their section's NAME (resolved
  // via the section recipe), preserving stable ordering. Components
  // whose `section.handle` references a section not in the set are
  // silently skipped here — the per-recipe compile pass already throws
  // INPUT_INVALID for that case via `resolveSectionRecipe`.
  const sectionToHandles = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    if (!recipe.section) continue;
    const section = sectionsByHandle.get(recipe.section.handle);
    if (!section) continue;
    const list = sectionToHandles.get(section.name) ?? [];
    list.push(recipe.handle);
    sectionToHandles.set(section.name, list);
  }
  if (sectionToHandles.size === 0) return null;

  // Reverse-lookup name → section recipe so we can stamp the section's
  // `displayName` (and icon, when present) on the Available Renderings
  // section item — that's what shows in the SXA Pages toolbox.
  const sectionByName = new Map<string, import("./schema/recipe").ComponentSectionRecipe>();
  for (const section of sectionsByHandle.values()) {
    sectionByName.set(section.name, section);
  }

  const operations: Operation[] = [];
  for (const [section, handles] of sectionToHandles) {
    const sectionRecipe = sectionByName.get(section);
    const displayName = sectionRecipe?.displayName ?? section;
    const sectionRefKey = availableRenderingsSectionId(site, section);
    const sectionPath = joinPath(root, section);
    const sectionFields: import("./ir/operations").FieldValue[] = [
      {
        fieldId: SYSTEM_FIELDS.DISPLAY_NAME,
        language: "en",
        version: 1,
        value: { kind: "string", value: displayName },
      },
    ];
    if (sectionRecipe?.icon) {
      sectionFields.push({
        fieldId: SYSTEM_FIELDS.ICON,
        value: { kind: "string", value: sectionRecipe.icon },
      });
    }
    if (sectionRecipe?.sortOrder !== undefined) {
      sectionFields.push({
        fieldId: SYSTEM_FIELDS.SORT_ORDER,
        value: { kind: "number", value: sectionRecipe.sortOrder },
      });
    }
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `available-renderings-section:${site}:${section}`,
      id: sectionRefKey,
      path: sectionPath,
      parent: { kind: "ref-path", value: root },
      templateOf: SITECORE_TEMPLATES.AVAILABLE_RENDERINGS,
      name: section,
      fields: sectionFields,
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
 * Build the synthetic IR that materialises subtree ownership for
 * `ComponentSectionRecipe`s whose `ownership.mode` is `"exclusive"`.
 * Per exclusively-owned section, emits TWO `PruneChildren` ops — one
 * targeting the renderings folder (`<renderingsRoot>/<section.name>`),
 * one targeting the templates section folder
 * (`<componentsRoot>/<section.name>`). Both carry `allowedHandles`
 * listing the recipe set's contributions and a `templateFilter`
 * scoping the prune to actual rendering / template items so co-located
 * bucket folders ("Component Folders", "Presentation Parameters") stay
 * untouched.
 *
 * The op's `mode` defaults to the section's `ownership.pruneMode`
 * (`"warn"` by default — rehearsal-first). The operator still needs to
 * pass `--allow-prune` for `"delete"`-mode ops to actually fire.
 *
 * Multi-list ownership (the Available Renderings field) is folded into
 * the existing `buildAvailableRenderingsAggregate`, which uses
 * SetField (full-replace semantics) — so an exclusive ComponentSection
 * gets full ownership of BOTH the subtree AND the multi-list from a
 * single declaration. Authors don't have to coordinate two recipes.
 *
 * Returns `null` when no ComponentSection declares exclusive ownership.
 */
const buildComponentSectionSubtreeOwnershipAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext
): OperationIr | null => {
  const site = siteOf(context);

  const exclusiveSections = new Map<string, import("./schema/recipe").ComponentSectionRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-section") continue;
    if (recipe.ownership?.mode !== "exclusive") continue;
    exclusiveSections.set(recipe.handle, recipe);
  }
  if (exclusiveSections.size === 0) return null;

  // Gather component recipes per exclusive section (matching via the
  // component's `section.handle`). These contribute the `allowedHandles`
  // for the section's renderings folder prune.
  const sectionToRenderings = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    if (!recipe.section) continue;
    if (!exclusiveSections.has(recipe.section.handle)) continue;
    const list = sectionToRenderings.get(recipe.section.handle) ?? [];
    list.push(recipe.handle);
    sectionToRenderings.set(recipe.section.handle, list);
  }

  const operations: Operation[] = [];
  for (const [sectionHandle, section] of exclusiveSections) {
    const componentHandles = (sectionToRenderings.get(sectionHandle) ?? []).sort((a, b) =>
      a.localeCompare(b)
    );
    const mode = section.ownership?.pruneMode ?? "warn";

    // Renderings folder prune. The section folder is created by
    // `compileComponentSectionRecipe` (rank 0) before this aggregate
    // runs, so the refKey is in the captured map by the time the
    // PruneChildren lands. No latePath needed.
    operations.push({
      op: "PruneChildren",
      policy: policyFor("composition-structure"),
      label: `prune:renderings-section:${site}:${section.name}`,
      parentRefKey: renderingsSectionFolderId(site, section.name),
      allowedHandles: componentHandles.map((handle) => ({
        kind: "ref-recipe" as const,
        refKey: renderingId(site, handle),
      })),
      // Limit to the SXA Rendering template so co-located non-rendering
      // items (any future scaffolding under the folder) stay put.
      templateFilter: [SITECORE_TEMPLATES.RENDERING],
      mode,
    } satisfies PruneChildrenOp);

    // Templates section folder prune. Component template items live as
    // direct children of `<componentsRoot>/<section.name>/`, alongside
    // bucket folders ("Component Folders", "Presentation Parameters")
    // that conform to `TEMPLATE_FOLDER` rather than `TEMPLATE`. The
    // template filter restricts the prune to actual component-template
    // items so the buckets stay untouched — wiping them would orphan
    // the per-component datasource folder templates and presentation-
    // parameter templates that live inside.
    operations.push({
      op: "PruneChildren",
      policy: policyFor("composition-structure"),
      label: `prune:templates-section:${site}:${section.name}`,
      parentRefKey: sectionFolderId(site, section.name),
      allowedHandles: componentHandles.map((handle) => ({
        kind: "ref-recipe" as const,
        refKey: templateId(site, handle),
      })),
      templateFilter: [SITECORE_TEMPLATES.TEMPLATE],
      mode,
    } satisfies PruneChildrenOp);
  }

  if (operations.length === 0) return null;

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE,
    operations,
  });
};

/**
 * One contributing recipe pointing at a shared `(site, subfolder)`.
 * Recorded by the pre-pass walk in `compileRecipeSet`.
 */
interface SharedSubfolderContribution {
  /** Recipe handle — used as the seed for `templateId(site, handle)`. */
  recipeHandle: string;
}

/**
 * Pre-pass over the input recipe set that maps each site-scoped
 * subfolder to its contributing component-template recipes. The
 * returned map only includes keys with ≥2 contributions — singletons
 * stay on the per-recipe template path.
 *
 * Key shape: `${site}::${subfolder}` — site is uniform across the set
 * today, but threading it into the key keeps the structure valid if
 * cross-site recipe sets ever land.
 */
const detectSharedSubfolders = (
  recipes: readonly Recipe[],
  site: string
): Map<string, SharedSubfolderContribution[]> => {
  const all = new Map<string, SharedSubfolderContribution[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    const locations = recipe.datasource?.locations ?? [];
    for (const location of locations) {
      if (location.scope !== "site" || !location.subfolder) continue;
      const key = `${site}::${location.subfolder}`;
      const list = all.get(key) ?? [];
      list.push({ recipeHandle: recipe.handle });
      all.set(key, list);
    }
  }
  // Filter out singletons — only `(site, subfolder)` pairs with ≥2
  // contributors flip to the shared coalescer; the singleton path
  // already does the right thing via the per-recipe template.
  const shared = new Map<string, SharedSubfolderContribution[]>();
  for (const [key, list] of all) {
    if (list.length >= 2) shared.set(key, list);
  }
  return shared;
};

/**
 * Build the synthetic IR materialising the SHARED Data Folder template
 * tree — one template + SV + base-templates link + SetStandardValues
 * per shared `(site, subfolder)` pair detected by
 * `detectSharedSubfolders`. The Insert Options `SetField` is emitted
 * separately by `buildSharedDataFolderInsertOptionsAggregate` so the two
 * halves can sit on opposite sides of the per-recipe IRs (see
 * `SHARED_DATA_FOLDER_INSERT_OPTIONS_AGGREGATE_HANDLE`). This IR is
 * prepended to the IR list so the templates exist before any per-recipe
 * folder ITEM references them via `templateOf`.
 *
 * Path layout: `<componentsRoot>/Data Folders/<…intermediates>/<leaf> Data Folder`.
 * Multi-segment subfolders (`ui/badges`) split on `/`; the leaf becomes
 * `<leaf> Data Folder` and the intermediate segments are stitched into
 * the parent ref-path so the executor's path-walker auto-creates them.
 *
 * Falls back to `templatesRoot` when `componentsRoot` is unset (matches
 * the legacy fallback elsewhere in the compiler).
 *
 * Returns null when no shared subfolders exist.
 */
const buildSharedDataFoldersAggregate = (
  shared: Map<string, SharedSubfolderContribution[]>,
  context: CompileContext,
  site: string
): OperationIr | null => {
  if (shared.size === 0) return null;

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe("component-template");
  const icon = DEFAULT_ICON;
  const componentsRoot = context.componentsRoot ?? context.templatesRoot;
  const dataFoldersBase = joinPath(componentsRoot, "Data Folders");

  // Stable iteration order — sort the keys lexicographically so the IR
  // is deterministic across runs.
  const sortedKeys = [...shared.keys()].sort((a, b) => a.localeCompare(b));

  for (const key of sortedKeys) {
    // Key is `${site}::${subfolder}`; the subfolder may itself contain
    // `::` if authored that way (unlikely but legal), so split on the
    // FIRST `::` only.
    const sepIdx = key.indexOf("::");
    const subfolder = key.slice(sepIdx + 2);

    const segments = subfolder
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    // Pre-pass already filters out empty subfolders (the `!!l.subfolder`
    // check), but defend against authored multi-`/` strings collapsing
    // to nothing after trim — skip rather than emitting a malformed op.
    if (segments.length === 0) continue;
    const leafSegment = segments[segments.length - 1]!;
    const intermediateSegments = segments.slice(0, -1);
    const folderName = `${leafSegment} Data Folder`;
    const parentPath =
      intermediateSegments.length > 0
        ? joinPath(dataFoldersBase, intermediateSegments.join("/"))
        : dataFoldersBase;
    const folderPath = joinPath(parentPath, folderName);

    const tplRefKey = sharedDataFolderTemplateId(site, subfolder);
    const svRefKey = sharedDataFolderStandardValuesId(site, subfolder);

    operations.push({
      op: "CreateItem",
      policy,
      label: `shared-data-folder-template:${subfolder}`,
      id: tplRefKey,
      path: folderPath,
      parent: { kind: "ref-path", value: parentPath },
      templateOf: SITECORE_TEMPLATES.TEMPLATE,
      name: folderName,
      fields: [
        { fieldId: SYSTEM_FIELDS.ICON, value: { kind: "string", value: icon } },
        {
          fieldId: SYSTEM_FIELDS.DISPLAY_NAME,
          language: "en",
          version: 1,
          value: { kind: "string", value: folderName },
        },
      ],
    } satisfies CreateItemOp);

    operations.push({
      op: "SetBaseTemplates",
      policy,
      label: `shared-data-folder-base-templates:${subfolder}`,
      itemRefKey: tplRefKey,
      baseTemplates: [STANDARD_TEMPLATE_ID],
    } satisfies SetBaseTemplatesOp);

    operations.push({
      op: "CreateItem",
      policy,
      label: `shared-data-folder-standard-values:${subfolder}`,
      id: svRefKey,
      path: joinPath(folderPath, "__Standard Values"),
      parent: { kind: "ref-recipe", refKey: tplRefKey },
      templateOf: tplRefKey,
      name: "__Standard Values",
      fields: [],
    } satisfies CreateItemOp);

    operations.push({
      op: "SetStandardValues",
      policy,
      label: `link-shared-data-folder-standard-values:${subfolder}`,
      templateRefKey: tplRefKey,
      standardValuesRefKey: svRefKey,
    } satisfies SetStandardValuesOp);

    // NOTE: the Insert Options `SetField` is emitted separately by
    // `buildSharedDataFolderInsertOptionsAggregate` so it can run AFTER
    // the per-recipe IRs (its `ref-recipe-list` references each
    // contributing recipe's datasource template). This template-creation
    // IR runs BEFORE the per-recipe IRs so their folder ITEMs (whose
    // `templateOf` is this template) resolve.
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: SHARED_DATA_FOLDERS_AGGREGATE_HANDLE,
    operations,
  });
};

/**
 * Build the synthetic IR carrying the Insert Options `SetField` for each
 * shared `(site, subfolder)` Data Folder template's `__Standard Values`.
 *
 * Separated from `buildSharedDataFoldersAggregate` (template creation)
 * because it must be ordered AFTER the per-recipe IRs: the
 * `ref-recipe-list` references each contributing recipe's datasource
 * template (`templateId(site, handle)`), created by those recipes. The
 * `itemRefKey` (the shared SV) is created by the template-creation IR
 * that runs at the front of the list, so it is already captured by the
 * time this SetField resolves.
 *
 * Returns null when no shared subfolders exist.
 */
const buildSharedDataFolderInsertOptionsAggregate = (
  shared: Map<string, SharedSubfolderContribution[]>,
  site: string
): OperationIr | null => {
  if (shared.size === 0) return null;

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe("component-template");

  const sortedKeys = [...shared.keys()].sort((a, b) => a.localeCompare(b));

  for (const key of sortedKeys) {
    const contributions = shared.get(key)!;
    const sepIdx = key.indexOf("::");
    const subfolder = key.slice(sepIdx + 2);

    const segments = subfolder
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) continue;

    const svRefKey = sharedDataFolderStandardValuesId(site, subfolder);

    // Insert Options aggregates every contributing recipe's datasource
    // template, sorted by handle so re-pushes don't drift the field
    // value across runs (the executor would otherwise diff-then-write
    // identical content with a different ordering).
    const sortedHandles = contributions
      .map((c) => c.recipeHandle)
      .sort((a, b) => a.localeCompare(b));
    operations.push({
      op: "SetField",
      policy,
      label: `shared-data-folder-insert-options:${subfolder}`,
      itemRefKey: svRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: sortedHandles.map((handle) => templateId(site, handle)),
      },
    } satisfies SetFieldOp);
  }

  if (operations.length === 0) return null;

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: SHARED_DATA_FOLDER_INSERT_OPTIONS_AGGREGATE_HANDLE,
    operations,
  });
};

/**
 * Build the synthetic IR materialising the site Data folder ROOT's
 * `__Standard Values` item, with `__Masters` (Insert Options)
 * aggregating: the generic Sitecore Folder template; every per-recipe
 * `<Component> Data Folder` template emitted by recipes that own at
 * least one SINGLETON site-scoped subfolder; and every shared
 * `<Subfolder> Data Folder` template emitted by the coalescer for
 * `(site, subfolder)` pairs touched by ≥2 recipes.
 *
 * Output layout:
 *   - `CreateItem` (CreateOnly) for `__Standard Values` directly under
 *     `<contentItemsRoot>`. The data root ITEM itself is tenant-pre-
 *     existing (or lazy-created); we only own its SV.
 *   - `SetField` writing `SYSTEM_FIELDS.INSERT_OPTIONS` on the SV with
 *     a `ref-recipe-list` value of the union list.
 *
 * Sort: per-recipe singleton entries are sorted alphabetically by
 * recipe handle; shared entries are sorted alphabetically by
 * subfolder. Concatenated [Folder, ...singletons, ...shared] is the
 * deterministic emission order.
 *
 * Returns null when there are zero contributing recipes (no
 * site-scoped subfolders in the recipe set) or when
 * `contentItemsRoot` is unset (recipes that need it already error
 * individually inside `compileComponentTemplateRecipe`).
 */
const buildSiteDataRootAggregate = (
  recipes: readonly Recipe[],
  sharedSubfolders: ReadonlySet<string>,
  context: CompileContext,
  site: string
): OperationIr | null => {
  if (!context.contentItemsRoot) return null;

  // Walk recipes once: collect singleton-contributing handles (each
  // recipe with ≥1 NON-shared site-scoped subfolder contributes once)
  // and shared-contributing subfolders (each shared subfolder
  // contributes once, regardless of how many recipes target it).
  const singletonHandles = new Set<string>();
  const sharedSubfolderRefs = new Set<string>();
  let hasAnySiteSubfolder = false;
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    const locations = recipe.datasource?.locations ?? [];
    let hasSingleton = false;
    for (const location of locations) {
      if (location.scope !== "site" || !location.subfolder) continue;
      hasAnySiteSubfolder = true;
      if (sharedSubfolders.has(location.subfolder)) {
        sharedSubfolderRefs.add(location.subfolder);
      } else {
        hasSingleton = true;
      }
    }
    if (hasSingleton) {
      singletonHandles.add(recipe.handle);
    }
  }
  if (!hasAnySiteSubfolder) return null;

  const sortedSingletonHandles = [...singletonHandles].sort((a, b) => a.localeCompare(b));
  const sortedSharedSubfolders = [...sharedSubfolderRefs].sort((a, b) => a.localeCompare(b));

  const policy = defaultPolicyForRecipe("component-template");
  const svRefKey = siteDataRootStandardValuesId(site);
  const svPath = joinPath(context.contentItemsRoot, "__Standard Values");

  const operations: Operation[] = [];
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `site-data-root-standard-values:${site}`,
    id: svRefKey,
    path: svPath,
    parent: { kind: "ref-path", value: context.contentItemsRoot },
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: "__Standard Values",
    fields: [],
  } satisfies CreateItemOp);

  const refKeys: string[] = [
    SITECORE_TEMPLATES.FOLDER,
    ...sortedSingletonHandles.map((handle) => siteDataFolderTemplateId(site, handle)),
    ...sortedSharedSubfolders.map((subfolder) => sharedDataFolderTemplateId(site, subfolder)),
  ];

  operations.push({
    op: "SetField",
    policy,
    label: `site-data-root-insert-options:${site}`,
    itemRefKey: svRefKey,
    fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
    value: {
      kind: "ref-recipe-list",
      refKeys,
    },
  } satisfies SetFieldOp);

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: SITE_DATA_ROOT_AGGREGATE_HANDLE,
    operations,
  });
};

/**
 * Build the synthetic IR materialising the enumerations root's
 * `__Standard Values` item + Insert Options aggregating the generic
 * Folder template plus every per-recipe `enumerationFolderId(site,
 * handle)` in the set.
 *
 * Per-recipe entries are sorted alphabetically by recipe handle so
 * the IR is deterministic across recipe orderings.
 *
 * Returns null when there are zero `EnumerationRecipe`s in the set
 * or when `enumerationsRoot` is unset (the per-recipe compiler
 * already errors individually when the root is missing on a recipe
 * that needs it).
 */
const buildEnumerationsRootAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext,
  site: string
): OperationIr | null => {
  if (!context.enumerationsRoot) return null;

  const handles: string[] = [];
  for (const recipe of recipes) {
    if (recipe.kind !== "enumeration") continue;
    handles.push(recipe.handle);
  }
  if (handles.length === 0) return null;

  const sortedHandles = [...handles].sort((a, b) => a.localeCompare(b));
  const policy = defaultPolicyForRecipe("enumeration");
  const rootRefKey = enumerationsRootId(site);
  const svRefKey = enumerationsRootStandardValuesId(site);
  const svPath = joinPath(context.enumerationsRoot, "__Standard Values");

  // Derive the root's parent path + leaf name from `enumerationsRoot`
  // (e.g. `<site>/Presentation/Enumerations` → parent
  // `<site>/Presentation`, name `Enumerations`).
  const lastSlash = context.enumerationsRoot.lastIndexOf("/");
  const rootParentPath = context.enumerationsRoot.slice(0, lastSlash);
  const rootName = context.enumerationsRoot.slice(lastSlash + 1);

  const operations: Operation[] = [];
  // Explicit emit for the enumerations root item itself. Without this,
  // the executor's path-walker auto-creates it as the generic `Folder`
  // template the first time a child op lands, leaving the SXA editor
  // showing the default folder icon. The explicit op stamps the
  // enumeration glyph (matching `Enumeration` / `Enumerations Folder`
  // templates) via `__Icon`, so the root visually reads as "the
  // enumerations bucket" instead of a generic folder. Policy is
  // CreateAndUpdate so the icon retroactively fixes tenants where the
  // root already exists.
  operations.push({
    op: "CreateItem",
    policy,
    label: `enumerations-root:${site}`,
    id: rootRefKey,
    path: context.enumerationsRoot,
    parent: { kind: "ref-path", value: rootParentPath },
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: rootName,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: ENUMERATION_ICON })],
  } satisfies CreateItemOp);

  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `enumerations-root-standard-values:${site}`,
    id: svRefKey,
    path: svPath,
    parent: { kind: "ref-recipe", refKey: rootRefKey },
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: "__Standard Values",
    fields: [],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetField",
    policy,
    label: `enumerations-root-insert-options:${site}`,
    itemRefKey: svRefKey,
    fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
    value: {
      kind: "ref-recipe-list",
      refKeys: [
        SITECORE_TEMPLATES.FOLDER,
        ...sortedHandles.map((handle) => enumerationFolderId(site, handle)),
      ],
    },
  } satisfies SetFieldOp);

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: ENUMERATIONS_ROOT_AGGREGATE_HANDLE,
    operations,
  });
};

/**
 * Derive a Sitecore item name from a placeholder key. Keys carry shapes
 * item names can't (`/header`, `headless-main-{*}`); this strips the
 * leading slash, drops `{…}` dynamic segments, and collapses remaining
 * slashes to hyphens. Used only for inline `placeholders` slots — a
 * standalone `PlaceholderRecipe` supplies `name` explicitly.
 */
const placeholderItemName = (key: string): string => {
  const cleaned = key
    .replace(/^\/+/, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\/+/g, "-")
    .replace(/-+$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "placeholder";
};

/** One unique placeholder key collected across the recipe set. */
interface PlaceholderDecl {
  key: string;
  /** Sitecore item name under the placeholder settings root. */
  name: string;
  displayName: string;
  icon?: string;
  /** Optional grouping folder segments under the root. Schema-level
   *  `FolderPath` already normalised input from both the array form
   *  (`["Partial Design", "Header"]`) and the legacy slash-string
   *  (`"Partial Design/Header"`) into this `string[]` shape. */
  folder?: string[];
  /** `component-template` handles allowed in this placeholder. */
  allowed: Set<string>;
}

/**
 * Build the synthetic IR materialising the Placeholder Settings items
 * for the recipe set — the hybrid placeholder model's emission seam.
 *
 * Collects every recipe-defined placeholder key:
 *   - standalone `PlaceholderRecipe` (key + metadata + allowedComponents)
 *   - inline `ComponentTemplateRecipe.placeholders` (key + allowedComponents)
 *
 * A `folder` (on either form) nests the item under
 * `<placeholderSettingsRoot>/<folder>/<name>` — each path segment is a
 * `CreateOnly` grouping folder conforming to the SXA `Placeholder
 * Settings Folder` template (deduped across the set), so it inherits
 * that template's Insert Options.
 *
 * For each unique key it emits:
 *   1. `CreateItem` (CreateOnly) for the Placeholder Settings item under
 *      `placeholderSettingsRoot` (or its `folder` subtree), carrying the
 *      `Placeholder Key` field.
 *   2. `SetField(Allowed Controls)` — a `ref-recipe-list` of rendering
 *      refKeys, the UNION of slot-side `allowedComponents` and every
 *      component naming the key in `placedIn`. One aggregated write per
 *      key (full-replace is safe — scai owns these items), `tolerateMissing`
 *      so an aborted sibling rendering IR doesn't fail the whole write.
 *
 * `placedIn` keys with no recipe declaration are NOT materialised here —
 * those are pre-existing tenant placeholders, resolved post-IR by
 * `applyPlaceholderAllowControls`.
 *
 * Returns null when the set declares no placeholders. Throws
 * INPUT_INVALID when it declares placeholders but `placeholderSettingsRoot`
 * is unconfigured.
 */
const buildPlaceholderSettingsAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext,
  site: string
): OperationIr | null => {
  const byKey = new Map<string, PlaceholderDecl>();
  const ensure = (key: string): PlaceholderDecl => {
    let decl = byKey.get(key);
    if (!decl) {
      decl = { key, name: placeholderItemName(key), displayName: key, allowed: new Set() };
      byKey.set(key, decl);
    }
    return decl;
  };

  for (const recipe of recipes) {
    if (recipe.kind === "placeholder") {
      const decl = ensure(recipe.key);
      decl.name = recipe.name;
      decl.displayName = recipe.displayName;
      if (recipe.icon) decl.icon = recipe.icon;
      if (recipe.folder) decl.folder = recipe.folder;
      for (const handle of recipe.allowedComponents ?? []) decl.allowed.add(handle);
    } else if (recipe.kind === "component-template") {
      for (const slot of recipe.placeholders ?? []) {
        const decl = ensure(slot.key);
        // Inline displayName / folder only fill in when nothing better
        // is set (a PlaceholderRecipe for the same key wins).
        if (slot.displayName && decl.displayName === decl.key) {
          decl.displayName = slot.displayName;
        }
        if (slot.folder && decl.folder === undefined) decl.folder = slot.folder;
        // Slot-side allow list. Accept both `allowedComponents` (scai's
        // historical name) and `allowedRenderingHandles` (the
        // registry-side alias) — see resolveAllowedHandles in
        // schema/recipe.ts. Earlier the compiler only read
        // `allowedComponents`, so recipes authored with
        // `allowedRenderingHandles` silently dropped their restriction
        // on the Sitecore side (e.g. accordion-block's Headless
        // placeholder accepting any rendering).
        for (const handle of resolveAllowedHandles(slot)) decl.allowed.add(handle);
      }
    }
  }

  if (byKey.size === 0) return null;

  if (!context.placeholderSettingsRoot) {
    throw createScaiError(
      "Recipe set declares placeholders (PlaceholderRecipe or inline component placeholders) but no placeholderSettingsRoot is configured.",
      "INPUT_INVALID",
      {
        hint: "Set `placeholderSettingsRoot` on the active envProfile in sitecoreai.cli.json — e.g. `/sitecore/content/<site>/Presentation/Placeholder Settings`.",
      }
    );
  }

  // Component-side allow pushes: a `placedIn` entry naming a
  // recipe-defined key contributes that component to the key's
  // whitelist. `placedIn` keys with no declaration are skipped (left
  // to the runtime placeholder-allow task).
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    for (const key of recipe.placedIn ?? []) {
      byKey.get(key)?.allowed.add(recipe.handle);
    }
  }

  const root = context.placeholderSettingsRoot;
  const policy = defaultPolicyForRecipe("placeholder");
  const operations: Operation[] = [];

  // Materialise a placeholder `folder` path, emitting one CreateOnly
  // grouping folder per segment (deduped across the aggregate). Each
  // folder conforms to the SXA `Placeholder Settings Folder` template,
  // so it inherits that template's Insert Options whitelist. Returns the
  // parent ref + path the leaf placeholder item lands under.
  const emittedFolders = new Set<string>();
  const resolveFolderParent = (
    folder: string[] | undefined
  ): { parent: CreateItemOp["parent"]; basePath: string } => {
    // `folder` is normalised to `string[]` at the schema boundary
    // (`FolderPath` in schema/recipe.ts) — both array and legacy
    // slash-string inputs land here as a clean segment list.
    const segments = folder ?? [];
    let parentPath = root;
    let parentRef: CreateItemOp["parent"] = { kind: "ref-path", value: root };
    let cumulative = "";
    for (const segment of segments) {
      cumulative = cumulative ? `${cumulative}/${segment}` : segment;
      const folderRefKey = placeholderSettingsFolderId(site, cumulative);
      const folderPath = joinPath(parentPath, segment);
      if (!emittedFolders.has(folderRefKey)) {
        emittedFolders.add(folderRefKey);
        operations.push({
          op: "CreateItem",
          policy: "CreateOnly",
          label: `placeholder-settings-folder:${site}:${cumulative}`,
          id: folderRefKey,
          path: folderPath,
          parent: parentRef,
          templateOf: PLACEHOLDER_SETTINGS_FOLDER_TEMPLATE_ID,
          name: segment,
          // No fields — the folder inherits its icon and Insert Options
          // from the Placeholder Settings Folder template.
          fields: [],
        } satisfies CreateItemOp);
      }
      parentPath = folderPath;
      parentRef = { kind: "ref-recipe", refKey: folderRefKey };
    }
    return { parent: parentRef, basePath: parentPath };
  };

  for (const key of [...byKey.keys()].sort((a, b) => a.localeCompare(b))) {
    const decl = byKey.get(key)!;
    const refKey = placeholderSettingsId(site, key);
    const { parent, basePath } = resolveFolderParent(decl.folder);
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `placeholder-settings:${site}:${key}`,
      id: refKey,
      path: joinPath(basePath, decl.name),
      parent,
      templateOf: PLACEHOLDER_TEMPLATE_ID,
      name: decl.name,
      fields: [
        sharedField(PLACEHOLDER_FIELDS.PLACEHOLDER_KEY, { kind: "string", value: decl.key }),
        ...(decl.icon
          ? [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: decl.icon })]
          : []),
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: decl.displayName }),
      ],
    } satisfies CreateItemOp);

    const sortedHandles = [...decl.allowed].sort((a, b) => a.localeCompare(b));
    operations.push({
      op: "SetField",
      policy,
      label: `placeholder-allowed-controls:${site}:${key}`,
      itemRefKey: refKey,
      fieldId: PLACEHOLDER_FIELDS.ALLOWED_CONTROLS,
      value: {
        kind: "ref-recipe-list",
        refKeys: sortedHandles.map((handle) => renderingId(site, handle)),
        tolerateMissing: true,
      },
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE,
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

  // Pre-pass: detect site-scoped subfolders shared by ≥2 recipes.
  // Threaded into `compileComponentTemplateRecipe` via `CompileContext`
  // so per-recipe emission can swap the folder ITEM's `templateOf` to
  // the shared template and skip emitting its own template when ALL of
  // its site-scoped subfolders are shared.
  const setSiteForShared = siteOf(context);
  const sharedSubfolderContributions = detectSharedSubfolders(recipes, setSiteForShared);
  const sharedSubfolders: ReadonlySet<string> = new Set(
    [...sharedSubfolderContributions.keys()].map((k) => k.slice(k.indexOf("::") + 2))
  );
  // Build the cross-recipe section map so component recipes can resolve
  // `section.handle` → ComponentSectionRecipe at compile time. Threaded
  // into perRecipeContext below.
  const sectionsByHandle = new Map<string, import("./schema/recipe").ComponentSectionRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind === "component-section") {
      sectionsByHandle.set(recipe.handle, recipe);
    }
  }

  // Cross-recipe enum map — used by `resolveFieldSource` to translate
  // `sitecore.enumHandle` references into the enum folder's tenant
  // path (the form Sitecore's Droplink Source needs; bare `{GUID}`
  // doesn't reliably surface picker options in SXA Headless's
  // rendering parameter dialog).
  const enumsByHandle = new Map<string, import("./schema/recipe").EnumerationRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind === "enumeration") {
      enumsByHandle.set(recipe.handle, recipe);
    }
  }

  // Cross-recipe component map — `compilePageRecipe` uses it to resolve
  // a scoped placement's component to its datasource template.
  const componentsByHandle = new Map<string, import("./schema/recipe").ComponentTemplateRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind === "component-template") {
      componentsByHandle.set(recipe.handle, recipe);
    }
  }

  // Cross-recipe site map — `compileDictionaryRecipe` uses it to
  // resolve a dictionary's host site to a content-tree path.
  const sitesByHandle = new Map<string, import("./schema/recipe").SiteRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind === "site") {
      sitesByHandle.set(recipe.handle, recipe);
    }
  }

  const perRecipeContext: CompileContext = {
    ...context,
    ...(sharedSubfolders.size > 0 ? { sharedSubfolders } : {}),
    ...(sectionsByHandle.size > 0 ? { sectionsByHandle } : {}),
    ...(enumsByHandle.size > 0 ? { enumsByHandle } : {}),
    ...(componentsByHandle.size > 0 ? { componentsByHandle } : {}),
    ...(sitesByHandle.size > 0 ? { sitesByHandle } : {}),
  };

  // Process section recipes FIRST so their rich-fields folder ops seed
  // `emittedFolders` sentinels before any component recipe's `ensure*`
  // helpers run. This way the section folder, renderings section folder,
  // and headless variants section all carry the section's icon /
  // displayName / sortOrder rather than the default-folder-icon a
  // component-recipe-driven emission would write.
  const sectionRecipes = recipes.filter((r) => r.kind === "component-section");
  const otherRecipes = recipes.filter((r) => r.kind !== "component-section");
  const orderedRecipes = [...sectionRecipes, ...otherRecipes];

  const irByHandle = new Map<string, OperationIr>();
  for (const recipe of orderedRecipes) {
    let ir: OperationIr;
    switch (recipe.kind) {
      case "component-section":
        ir = compileComponentSectionRecipe(recipe, perRecipeContext, emittedFolders);
        break;
      case "component-template":
        ir = compileComponentTemplateRecipe(recipe, perRecipeContext, emittedFolders);
        break;
      case "content-template":
        ir = compileContentTemplateRecipe(recipe, perRecipeContext, emittedFolders);
        break;
      case "page-template":
        ir = compilePageTemplateRecipe(recipe, perRecipeContext, emittedFolders);
        break;
      case "design-parameters-template":
        ir = compileDesignParametersTemplateRecipe(recipe, perRecipeContext, emittedFolders);
        break;
      case "enumeration":
        ir = compileEnumerationRecipe(recipe, perRecipeContext, emittedFolders);
        break;
      default:
        ir = compileRecipe(recipe, perRecipeContext);
    }
    irByHandle.set(recipe.handle, ir);
  }

  // Order per-recipe IRs by cross-recipe dependency rank so a referencing
  // recipe is always applied AFTER the definitions it points at — a page
  // after its page template, a page design after its partials, a site
  // after its site template. On a fresh push the executor resolves a
  // cross-recipe `templateOf` / ref-recipe only once the defining
  // recipe's IR has run; input (file-glob) order doesn't guarantee that
  // (`home@1` sorts before `page@1`).
  //
  // Within a single rank we ALSO topologically sort by recipe-level
  // handle dependencies — without this, alphabetic file-glob order can
  // put a referencing recipe before its referent at the same rank
  // (e.g. `accordion-block.recipe.ts` < `faq-content.recipe.ts` lex-
  // sorts the dependent first, then accordion-block's
  // `field.source.types: ["faq-content@1"]` `ref-source-fields` SetField
  // op fires before faq-content's CreateItem op runs → "not yet in
  // captured map"). Same applies to `insertOptions`, `placeholders.
  // allowedComponents`, and every other cross-recipe handle reference
  // enumerated by `extractRecipeDependencies` below. The sort is stable
  // (preserves input order among recipes with no dep relationship), so
  // intra-rank emission order for unrelated siblings (section folders,
  // etc.) is unchanged.
  const ranked = stableTopologicalSortWithinRanks(recipes);
  const irs: OperationIr[] = ranked.map((r) => irByHandle.get(r.handle)!);

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

  // Shared Data Folder coalescer aggregate — one shared template per
  // `(site, subfolder)` pair targeted by ≥2 component-template recipes.
  // Emitted as a sibling synthetic IR so per-recipe folder ITEMs (whose
  // `templateOf` is `sharedDataFolderTemplateId(...)`) have a target to
  // resolve against the captured-itemId map at apply time. Per-recipe
  // datasource template `CreateItem` ops also need to land before the
  // Insert Options SetField resolves; per-recipe IRs come earlier in
  // the returned list so the executor processes them first.
  // Shared Data Folder TEMPLATE creation must run BEFORE the per-recipe
  // IRs: each recipe's `site-data-folder` folder ITEM is created with
  // `templateOf = sharedDataFolderTemplateId(...)`, so the template must
  // already exist or Authoring GraphQL aborts with "Cannot find a
  // template with the <id> id" (which rolls back the owning recipe and
  // cascades to siblings sharing the section bucket). Prepend it.
  const sharedDataFolderTemplates = buildSharedDataFoldersAggregate(
    sharedSubfolderContributions,
    context,
    setSiteForShared
  );
  if (sharedDataFolderTemplates) {
    irs.unshift(sharedDataFolderTemplates);
  }

  // The matching Insert Options `SetField` runs AFTER the per-recipe IRs
  // (it references each contributing recipe's datasource template, which
  // those recipes create). The shared SV it targets was already created
  // by the prepended template IR above.
  const sharedDataFolderInsertOptions = buildSharedDataFolderInsertOptionsAggregate(
    sharedSubfolderContributions,
    setSiteForShared
  );
  if (sharedDataFolderInsertOptions) {
    irs.push(sharedDataFolderInsertOptions);
  }

  // Site Data folder ROOT Standard Values aggregator — emits the
  // `__Standard Values` item under `<contentItemsRoot>` with Insert
  // Options aggregating the generic Folder template, every per-recipe
  // singleton Data Folder template, and every shared Data Folder
  // template. Without this aggregate, authors right-clicking → Insert
  // at the data root see every template in Sitecore (the Folder root
  // has no Insert Options of its own).
  const siteDataRoot = buildSiteDataRootAggregate(
    recipes,
    sharedSubfolders,
    context,
    setSiteForShared
  );
  if (siteDataRoot) {
    irs.push(siteDataRoot);
  }

  // Enumerations root Standard Values aggregator — Insert Options
  // restrict authors' right-click → Insert at `<enumerationsRoot>` to
  // the generic Folder template + each EnumerationRecipe's folder
  // item. Without this, authors see every template in Sitecore.
  const enumerationsRoot = buildEnumerationsRootAggregate(recipes, context, setSiteForShared);
  if (enumerationsRoot) {
    irs.push(enumerationsRoot);
  }

  // Placeholder Settings aggregate — one CreateItem + Allowed Controls
  // SetField per unique placeholder key (standalone PlaceholderRecipe +
  // inline component placeholders). Emitted last so per-recipe rendering
  // CreateItem ops have run before its ref-recipe-list resolves.
  const placeholderSettings = buildPlaceholderSettingsAggregate(recipes, context, setSiteForShared);
  if (placeholderSettings) {
    irs.push(placeholderSettings);
  }

  // Subtree ownership aggregate — emits PruneChildren ops for sections
  // whose ComponentSectionRecipe declares ownership.children: "exclusive".
  // MUST run LAST so every rendering CreateItem op has landed and the
  // captured-itemId map is fully seeded; the planner reads live children
  // of each section folder and computes (children - allowedHandles) at
  // apply time, so any rendering the recipe set didn't produce is on the
  // prune candidate list.
  const componentSectionOwnership = buildComponentSectionSubtreeOwnershipAggregate(
    recipes,
    context
  );
  if (componentSectionOwnership) {
    irs.push(componentSectionOwnership);
  }

  // Invariant guard: any IR that emits a PruneChildren op MUST be
  // followed only by IRs that don't create items. Pruning happens last
  // (after the captured-itemId map is fully seeded by every CreateItem
  // in the recipe set); a future aggregate appended below the prune
  // emitter that introduces new CreateItems would corrupt the prune
  // candidate list — the planner reads live children at apply time and
  // would prune items the same push was about to create.
  //
  // This catches the regression at compile time, before any wire call.
  let firstPruneIrIndex = -1;
  for (let i = 0; i < irs.length; i += 1) {
    if (irs[i].operations.some((op) => op.op === "PruneChildren")) {
      firstPruneIrIndex = i;
      break;
    }
  }
  if (firstPruneIrIndex >= 0) {
    for (let i = firstPruneIrIndex + 1; i < irs.length; i += 1) {
      const offending = irs[i].operations.find((op) => op.op === "CreateItem");
      if (offending) {
        throw createScaiError(
          `Aggregate ordering invariant violated: IR '${irs[i].recipeHandle}' emits a CreateItem after the prune-emitting IR '${irs[firstPruneIrIndex].recipeHandle}' (offending op label: '${offending.label}'). PruneChildren must run LAST in compileRecipeSet — anything that creates items must appear before the prune aggregate.`,
          "UNKNOWN"
        );
      }
    }
  }

  return irs;
}

/** Front-door dispatcher — accepts any registered recipe kind. */
export function compileRecipe(input: Recipe, context: CompileContext): OperationIr {
  const recipe = RecipeSchema.parse(input);
  switch (recipe.kind) {
    case "component-section":
      return compileComponentSectionRecipe(recipe, context);
    case "component-template":
      return compileComponentTemplateRecipe(recipe, context);
    case "content-template":
      return compileContentTemplateRecipe(recipe, context);
    case "content-item":
      return compileContentItemRecipe(recipe, context);
    case "page-template":
      return compilePageTemplateRecipe(recipe, context);
    case "page":
      return compilePageRecipe(recipe, context);
    case "placeholder":
      return compilePlaceholderRecipe(recipe, context);
    case "design-parameters-template":
      return compileDesignParametersTemplateRecipe(recipe, context);
    case "partial-design":
      return compilePartialDesignRecipe(recipe, context);
    case "page-design":
      return compilePageDesignRecipe(recipe, context);
    case "site-template":
      return compileSiteTemplateRecipe(recipe, context);
    case "site":
      return compileSiteRecipe(recipe, context);
    case "dictionary":
      return compileDictionaryRecipe(recipe, context);
    case "enumeration":
      return compileEnumerationRecipe(recipe, context);
    case "workflow":
      return compileWorkflowRecipe(recipe, context);
    case "webhook-authorization":
      return compileWebhookAuthorizationRecipe(recipe, context);
    case "variant":
      return compileVariantRecipe(recipe, context);
  }
}
