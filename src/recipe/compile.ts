import {
  availableRenderingsSectionId,
  enumerationFolderId,
  enumerationsRootId,
  enumerationsRootStandardValuesId,
  PAGE_DESIGNS_ROOT_REF_KEY,
  pageDesignId,
  renderingId,
  sharedDataFolderStandardValuesId,
  sharedDataFolderTemplateId,
  siteDataFolderTemplateId,
  siteDataRootStandardValuesId,
  templateId,
} from "./guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "./ir/operations";
import { defaultPolicyForRecipe, policyFor } from "./policy";
import {
  AVAILABLE_RENDERINGS_FIELDS,
  COMPOSITION_FIELDS,
  DEFAULT_ICON,
  ENUMERATION_ICON,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
} from "./ir/sitecore-templates";
import { type Recipe, RecipeSchema } from "./schema/recipe";
import { encodeTemplatesMapping } from "./layout/templates-mapping";

import { compileComponentSectionRecipe } from "./compile/component-section";
import { compileComponentTemplateRecipe } from "./compile/component-template";
import { compileContentTemplateRecipe } from "./compile/content-template";
import { compileDesignParametersTemplateRecipe } from "./compile/design-parameters-template";
import { compileSectionDefinitionRecipe } from "./compile/section-definition";
import { compilePartialDesignRecipe } from "./compile/partial-design";
import { compilePageDesignRecipe } from "./compile/page-design";
import { compileContentItemRecipe } from "./compile/content-item";
import { compileSiteTemplateRecipe } from "./compile/site-template";
import { compileSiteRecipe } from "./compile/site";
import { compileEnumerationRecipe } from "./compile/enumeration";
import { joinPath, sharedField, siteOf, type CompileContext } from "./compile/shared";

// Re-export per-kind compile functions so existing import paths
// (`import { compileComponentTemplateRecipe } from "@/recipe/compile"`)
// keep working.
export {
  compileComponentSectionRecipe,
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  compileDesignParametersTemplateRecipe,
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
 * tree — one template + SV + base-templates link + Insert Options
 * SetField per shared `(site, subfolder)` pair detected by
 * `detectSharedSubfolders`.
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
    const contributions = shared.get(key)!;
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

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: SHARED_DATA_FOLDERS_AGGREGATE_HANDLE,
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

  const perRecipeContext: CompileContext = {
    ...context,
    ...(sharedSubfolders.size > 0 ? { sharedSubfolders } : {}),
    ...(sectionsByHandle.size > 0 ? { sectionsByHandle } : {}),
    ...(enumsByHandle.size > 0 ? { enumsByHandle } : {}),
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

  // Preserve INPUT order for IR output — section-first ordering was a
  // compile-time emission concern only, not a wire-order requirement.
  const irs: OperationIr[] = recipes.map((r) => irByHandle.get(r.handle)!);

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
  const sharedDataFolders = buildSharedDataFoldersAggregate(
    sharedSubfolderContributions,
    context,
    setSiteForShared
  );
  if (sharedDataFolders) {
    irs.push(sharedDataFolders);
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
    case "design-parameters-template":
      return compileDesignParametersTemplateRecipe(recipe, context);
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
