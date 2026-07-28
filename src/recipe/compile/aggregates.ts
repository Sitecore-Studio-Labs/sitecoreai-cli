/**
 * Cross-recipe **aggregate** builders for `compileRecipeSet`.
 *
 * An aggregate is a synthetic IR that materialises tenant state no single
 * author-defined recipe owns — the per-section Available Renderings list,
 * the shared Data Folder templates, the Placeholder Settings items, the
 * enumerations/site-data root Insert Options, and subtree ownership
 * prunes. Each builder walks the WHOLE recipe set and emits one IR (or
 * `null` when the set contributes nothing).
 *
 * ## `__name__` aggregate-handle convention
 *
 * Every synthetic IR the cross-recipe layer emits uses a handle wrapped
 * in double underscores: `__available-renderings__`,
 * `__placeholder-settings__`, etc.
 *
 * The convention is load-bearing:
 *   - **Author-handle collision is impossible** — recipe handles match
 *     `[a-z][a-z0-9-]*@\d+` (validated by `HandleString` in
 *     `schema/recipe.ts`), so leading underscores are unrepresentable in
 *     author input. `__foo__` is reserved for the compiler.
 *   - **Plan / push output greps cleanly** — anything matching `__.*__`
 *     in a recipe-set summary is a synthesized aggregate, not a real
 *     recipe-author intent.
 *   - **Apply-rank scheduling is uniform** — synthesized aggregates get
 *     explicit slots in `compileRecipeSet` so they run between rank
 *     tiers, not interleaved with author recipes.
 */
import { trimEndChar } from "@/shared/strings";
import { createScaiError } from "@/shared/errors";
import {
  availableRenderingsSectionId,
  enumerationFolderId,
  enumerationsFolderTemplateId,
  enumerationsRootId,
  enumerationsRootStandardValuesId,
  placeholderSettingsFolderId,
  placeholderSettingsId,
  renderingId,
  renderingsSectionFolderId,
  sectionFolderId,
  sharedDataFolderStandardValuesId,
  sharedDataFolderTemplateId,
  siteDataFolderTemplateId,
  siteDataFolderTemplateIdForLocation,
  siteDataRootStandardValuesId,
  templateId,
} from "../items/guids";
import {
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type PruneChildrenOp,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "../ir/operations";
import { defaultPolicyForRecipe, policyFor } from "../runtime/policy";
import {
  AVAILABLE_RENDERINGS_FIELDS,
  DEFAULT_ICON,
  ENUMERATION_ICON,
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_SETTINGS_FOLDER_TEMPLATE_ID,
  PLACEHOLDER_TEMPLATE_ID,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type ComponentSectionRecipe, type Recipe, resolveAllowedHandles } from "../schema/recipe";
import {
  datasourceTemplateHandles,
  joinPath,
  sharedField,
  siteOf,
  versionedField,
  type CompileContext,
} from "./shared";
import {
  ensureContentModelsGroupFolder,
  ensureEnumerationGroupingFolders,
  ensurePageTemplatesGroupFolder,
} from "./folders";
import { ensureEnumerationTemplates } from "./enumerations";

/** Stable handle for the per-section `Available Renderings` aggregate. */
export const AVAILABLE_RENDERINGS_AGGREGATE_HANDLE = "__available-renderings__";

/**
 * Stable handle for the synthetic IR that materialises SHARED Data Folder
 * templates — one per `(site, subfolder)` targeted by ≥2 component-template
 * recipes. Each shared template's `__Standard Values` Insert Options is the
 * union of every contributing recipe's datasource template.
 */
export const SHARED_DATA_FOLDERS_AGGREGATE_HANDLE = "__shared-data-folders__";

/**
 * Stable handle for the synthetic IR carrying the SHARED Data Folder
 * templates' Insert Options `SetField` ops.
 *
 * Split out from `SHARED_DATA_FOLDERS_AGGREGATE_HANDLE` (template/SV/base
 * creation) because the two halves have opposite ordering requirements
 * relative to the per-recipe IRs:
 *
 *   - Template creation must run BEFORE the per-recipe IRs — each recipe's
 *     `site-data-folder` folder ITEM is created with
 *     `templateOf = sharedDataFolderTemplateId(...)`, so the template must
 *     already exist (Authoring GraphQL rejects a createItem whose template
 *     GUID is unknown). Emitted at the FRONT of the IR list.
 *   - Insert Options must run AFTER the per-recipe IRs — the SetField's
 *     `ref-recipe-list` references each contributing recipe's datasource
 *     template (`templateId(site, handle)`), which the per-recipe IRs
 *     create. Emitted near the end of the IR list.
 */
export const SHARED_DATA_FOLDER_INSERT_OPTIONS_AGGREGATE_HANDLE =
  "__shared-data-folder-insert-options__";

/**
 * Stable handle for the site Data folder ROOT's `__Standard Values` +
 * Insert Options aggregate. Restricts right-click → Insert at
 * `<contentItemsRoot>` to the generic Folder template, every per-recipe
 * `<Component> Data Folder` template (singletons), and every shared
 * `<subfolder> Data Folder` template (coalesced shared subfolders).
 */
export const SITE_DATA_ROOT_AGGREGATE_HANDLE = "__site-data-root__";

/**
 * Stable handle for the enumerations root's `__Standard Values` + Insert
 * Options aggregate. Restricts right-click → Insert at `<enumerationsRoot>`
 * to the generic Folder template plus every per-recipe enumeration folder.
 */
export const ENUMERATIONS_ROOT_AGGREGATE_HANDLE = "__enumerations-root__";

/**
 * Stable handle for the shared enumeration TEMPLATE trio — the per-site
 * `Enumerations Folder`, `Enumeration`, and `Enumeration Value` templates,
 * their inner Value fields, and their `__Standard Values` + Insert Options.
 *
 * A FRONT aggregate: per-recipe enum items are created with
 * `templateOf = enumerationTemplateId(...)` / `enumerationsFolderTemplateId(...)`,
 * so the templates must already exist before any per-recipe IR applies.
 *
 * The reason it is an aggregate at all (rather than emitted by whichever
 * enum recipe compiles first, as it used to be): the templates'
 * `__Standard Values` items carry a tenant OWNERSHIP marker stamped with
 * the emitting IR's handle. A "first enum recipe" identity is not stable —
 * it shifts as the recipe set / topo-order changes across rebuilds, or as
 * batching splits enum recipes across separate `--handles` pushes — so a
 * later install would try to reconcile a `__Standard Values` owned by a
 * different recipe and abort with a name/ownership collision. Owning them
 * under this synthetic handle makes the marker deterministic across every
 * install.
 */
export const ENUMERATION_TEMPLATES_AGGREGATE_HANDLE = "__enumeration-templates__";

/**
 * Stable handle for the SECTION-INDEPENDENT shared organisational folders —
 * enumeration grouping folders (`location.folder`), Content Models group
 * folders, and Page Templates group folders (both `meta.tax.group`).
 *
 * A FRONT aggregate, for the same reason as the shared Data Folder / enum
 * templates: these folders are referenced by per-recipe items via
 * `templateOf` / `parent`, and are deterministic + shared across recipes.
 * Emitted inline today by the `ensure*` helpers into whichever recipe
 * compiled first, they get DROPPED from a `--handles` chunk that excludes
 * that owner — the executor's path-walker then auto-creates them as the
 * generic `Folder` template. For enumeration grouping folders that is an
 * author-visible bug (a generic Folder lacks the `Enumerations Folder`
 * Standard Values, so right-click → Insert offers no `Enumeration`).
 * Owning them here makes the emission batch-order-independent.
 *
 * NOTE: the section-scoped Component Folders / Presentation Parameters
 * BUCKETS are deliberately NOT hoisted here — they nest under section
 * folders that `ComponentSectionRecipe`s richly own (icon/displayName/
 * sortOrder) as per-recipe IRs, and a FRONT aggregate would invert that
 * ordering. They stay on the per-recipe `ensure*` path.
 */
export const SHARED_FOLDERS_AGGREGATE_HANDLE = "__shared-folders__";

/**
 * Stable handle for the Placeholder Settings items — one per unique
 * placeholder key declared anywhere in the set (a `PlaceholderRecipe` or
 * an inline `ComponentTemplateRecipe.placeholders` slot). Each key's
 * `Allowed Controls` whitelist is the union of slot-side `allowedComponents`
 * and every component naming the key in `placedIn`.
 */
export const PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE = "__placeholder-settings__";

/**
 * Stable handle for the synthetic IR that materialises subtree-level
 * ownership for `ComponentSectionRecipe`s whose `ownership.mode` is
 * `"exclusive"`. Per exclusively-owned section the aggregate emits
 * `PruneChildren` ops for BOTH the RENDERINGS section folder and the
 * TEMPLATES section folder (each with a `templateFilter` so co-located
 * bucket folders survive). NOT pruned: the SXA Headless Variants tree —
 * SXA stores per-rendering variant folders FLAT, so a section-scoped
 * ownership declaration can't safely address them.
 */
export const COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE = "__component-section-ownership__";

/**
 * Build the synthetic IR that materialises the SXA `Available Renderings`
 * section items for the recipe set, one per `recipe.section` value across
 * every component-template recipe.
 *
 * Each section emits two ops: a `CreateItem` for
 * `<availableRenderingsRoot>/<section>` and a `SetField(Renderings)`
 * writing the pipe-separated rendering itemIds (a `ref-recipe-list`
 * resolved against the captured-itemId map). Returns null when no
 * eligible recipes exist.
 */
export const buildAvailableRenderingsAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext
): OperationIr | null => {
  if (!context.availableRenderingsRoot) return null;

  const root = context.availableRenderingsRoot;
  const site = siteOf(context);

  const sectionsByHandle = new Map<string, ComponentSectionRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind === "component-section") sectionsByHandle.set(recipe.handle, recipe);
  }

  // Group component-template recipes by their section's NAME. Components
  // whose `section.handle` references a section not in the set are
  // skipped — the per-recipe compile pass already throws for that case.
  const sectionToHandles = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template" || !recipe.section) continue;
    const section = sectionsByHandle.get(recipe.section.handle);
    if (!section) continue;
    const list = sectionToHandles.get(section.name) ?? [];
    list.push(recipe.handle);
    sectionToHandles.set(section.name, list);
  }
  if (sectionToHandles.size === 0) return null;

  const sectionByName = new Map<string, ComponentSectionRecipe>();
  for (const section of sectionsByHandle.values()) sectionByName.set(section.name, section);

  const operations: Operation[] = [];
  for (const [section, handles] of sectionToHandles) {
    operations.push(
      availableRenderingsSectionItem(root, site, section, sectionByName.get(section))
    );
    const sortedHandles = [...handles].sort((a, b) => a.localeCompare(b));
    operations.push({
      op: "SetField",
      policy: policyFor("composition-structure"),
      label: `available-renderings-list:${site}:${section}`,
      itemRefKey: availableRenderingsSectionId(site, section),
      fieldId: AVAILABLE_RENDERINGS_FIELDS.RENDERINGS,
      value: {
        kind: "ref-recipe-list",
        refKeys: sortedHandles.map((handle) => renderingId(site, handle)),
        // Tolerant: if a sibling rendering IR aborted, write the rest
        // rather than failing the whole aggregate.
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

/** The `CreateItem` op for one Available Renderings section folder. */
const availableRenderingsSectionItem = (
  root: string,
  site: string,
  section: string,
  sectionRecipe: ComponentSectionRecipe | undefined
): CreateItemOp => {
  const displayName = sectionRecipe?.displayName ?? section;
  const fields: FieldValue[] = [
    {
      fieldId: SYSTEM_FIELDS.DISPLAY_NAME,
      language: "en",
      version: 1,
      value: { kind: "string", value: displayName },
    },
  ];
  if (sectionRecipe?.icon) {
    fields.push({
      fieldId: SYSTEM_FIELDS.ICON,
      value: { kind: "string", value: sectionRecipe.icon },
    });
  }
  if (sectionRecipe?.sortOrder !== undefined) {
    fields.push({
      fieldId: SYSTEM_FIELDS.SORT_ORDER,
      value: { kind: "number", value: sectionRecipe.sortOrder },
    });
  }
  return {
    op: "CreateItem",
    policy: "CreateOnly",
    label: `available-renderings-section:${site}:${section}`,
    id: availableRenderingsSectionId(site, section),
    path: joinPath(root, section),
    parent: { kind: "ref-path", value: root },
    templateOf: SITECORE_TEMPLATES.AVAILABLE_RENDERINGS,
    name: section,
    fields,
  } satisfies CreateItemOp;
};

/**
 * Build the synthetic IR that materialises subtree ownership for
 * `ComponentSectionRecipe`s whose `ownership.mode` is `"exclusive"`. Per
 * exclusively-owned section, emits TWO `PruneChildren` ops (renderings
 * folder + templates section folder), each carrying `allowedHandles` and
 * a `templateFilter` scoping the prune so co-located bucket folders stay
 * untouched. Returns `null` when no ComponentSection declares exclusive
 * ownership.
 */
export const buildComponentSectionSubtreeOwnershipAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext
): OperationIr | null => {
  const site = siteOf(context);

  const exclusiveSections = new Map<string, ComponentSectionRecipe>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-section") continue;
    if (recipe.ownership?.mode !== "exclusive") continue;
    exclusiveSections.set(recipe.handle, recipe);
  }
  if (exclusiveSections.size === 0) return null;

  const sectionToRenderings = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template" || !recipe.section) continue;
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
      // items stay put.
      templateFilter: [SITECORE_TEMPLATES.RENDERING],
      mode,
    } satisfies PruneChildrenOp);

    operations.push({
      op: "PruneChildren",
      policy: policyFor("composition-structure"),
      label: `prune:templates-section:${site}:${section.name}`,
      parentRefKey: sectionFolderId(site, section.name),
      allowedHandles: componentHandles.map((handle) => ({
        kind: "ref-recipe" as const,
        refKey: templateId(site, handle),
      })),
      // Restrict to actual component-template items so the "Component
      // Folders" / "Presentation Parameters" bucket folders survive.
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
export interface SharedSubfolderContribution {
  /** Recipe handle — display/dedup identity for the contribution. */
  recipeHandle: string;
  /**
   * The content-template handles the recipe's datasource items conform
   * to (see `datasourceTemplateHandles`). The shared folder's Insert
   * Options union references THESE — not the recipe handle — because
   * external-template components (`datasource.template` /
   * `datasource.templates[]`) never create a template under their own
   * handle.
   */
  datasourceTemplateHandles: string[];
}

/**
 * Pre-pass mapping each site-scoped subfolder to its contributing
 * component-template recipes. Only keys with ≥2 contributions are
 * returned — singletons stay on the per-recipe template path.
 *
 * Key shape: `${site}::${subfolder}`.
 */
export const detectSharedSubfolders = (
  recipes: readonly Recipe[],
  site: string
): Map<string, SharedSubfolderContribution[]> => {
  const all = new Map<string, SharedSubfolderContribution[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    for (const location of recipe.datasource?.locations ?? []) {
      if (location.scope !== "site" || !location.subfolder) continue;
      const key = `${site}::${location.subfolder}`;
      const list = all.get(key) ?? [];
      list.push({
        recipeHandle: recipe.handle,
        datasourceTemplateHandles: datasourceTemplateHandles(recipe),
      });
      all.set(key, list);
    }
  }
  const shared = new Map<string, SharedSubfolderContribution[]>();
  for (const [key, list] of all) {
    if (list.length >= 2) shared.set(key, list);
  }
  return shared;
};

/** Split a `${site}::${subfolder}` key into its trimmed path segments. */
const subfolderSegmentsOf = (key: string): { subfolder: string; segments: string[] } => {
  // Split on the FIRST `::` only — the subfolder may itself contain `::`.
  const subfolder = key.slice(key.indexOf("::") + 2);
  const segments = subfolder
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return { subfolder, segments };
};

/**
 * Build the synthetic IR materialising the SHARED Data Folder template
 * tree — one template + SV + base-templates link + SetStandardValues per
 * shared `(site, subfolder)` pair. The Insert Options `SetField` is
 * emitted separately (see `buildSharedDataFolderInsertOptionsAggregate`).
 * Prepended to the IR list so the templates exist before any per-recipe
 * folder ITEM references them via `templateOf`. Returns null when no
 * shared subfolders exist.
 */
export const buildSharedDataFoldersAggregate = (
  shared: Map<string, SharedSubfolderContribution[]>,
  context: CompileContext,
  site: string
): OperationIr | null => {
  if (shared.size === 0) return null;

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe("component-template");
  const componentsRoot = context.componentsRoot ?? context.templatesRoot;
  const dataFoldersBase = joinPath(componentsRoot, "Data Folders");

  for (const key of [...shared.keys()].sort((a, b) => a.localeCompare(b))) {
    const { subfolder, segments } = subfolderSegmentsOf(key);
    // Defend against authored multi-`/` strings collapsing to nothing.
    if (segments.length === 0) continue;
    operations.push(
      ...sharedDataFolderTemplateOps(dataFoldersBase, site, subfolder, segments, policy)
    );
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: SHARED_DATA_FOLDERS_AGGREGATE_HANDLE,
    operations,
  });
};

/** The template + base-templates + SV + link ops for one shared Data Folder. */
const sharedDataFolderTemplateOps = (
  dataFoldersBase: string,
  site: string,
  subfolder: string,
  segments: string[],
  policy: ReturnType<typeof defaultPolicyForRecipe>
): Operation[] => {
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

  return [
    {
      op: "CreateItem",
      policy,
      label: `shared-data-folder-template:${subfolder}`,
      id: tplRefKey,
      path: folderPath,
      parent: { kind: "ref-path", value: parentPath },
      templateOf: SITECORE_TEMPLATES.TEMPLATE,
      name: folderName,
      fields: [
        { fieldId: SYSTEM_FIELDS.ICON, value: { kind: "string", value: DEFAULT_ICON } },
        {
          fieldId: SYSTEM_FIELDS.DISPLAY_NAME,
          language: "en",
          version: 1,
          value: { kind: "string", value: folderName },
        },
      ],
    } satisfies CreateItemOp,
    {
      op: "SetBaseTemplates",
      policy,
      label: `shared-data-folder-base-templates:${subfolder}`,
      itemRefKey: tplRefKey,
      baseTemplates: [STANDARD_TEMPLATE_ID],
    } satisfies SetBaseTemplatesOp,
    {
      op: "CreateItem",
      policy,
      label: `shared-data-folder-standard-values:${subfolder}`,
      id: svRefKey,
      path: joinPath(folderPath, "__Standard Values"),
      parent: { kind: "ref-recipe", refKey: tplRefKey },
      templateOf: tplRefKey,
      name: "__Standard Values",
      fields: [],
    } satisfies CreateItemOp,
    {
      op: "SetStandardValues",
      policy,
      label: `link-shared-data-folder-standard-values:${subfolder}`,
      templateRefKey: tplRefKey,
      standardValuesRefKey: svRefKey,
    } satisfies SetStandardValuesOp,
  ];
};

/**
 * Build the synthetic IR carrying the Insert Options `SetField` for each
 * shared `(site, subfolder)` Data Folder template's `__Standard Values`.
 * Ordered AFTER the per-recipe IRs (its `ref-recipe-list` references each
 * contributing recipe's datasource template). Returns null when no shared
 * subfolders exist.
 */
export const buildSharedDataFolderInsertOptionsAggregate = (
  shared: Map<string, SharedSubfolderContribution[]>,
  site: string
): OperationIr | null => {
  if (shared.size === 0) return null;

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe("component-template");

  for (const key of [...shared.keys()].sort((a, b) => a.localeCompare(b))) {
    const contributions = shared.get(key)!;
    const { subfolder, segments } = subfolderSegmentsOf(key);
    if (segments.length === 0) continue;

    // Union of every contribution's datasource template handles,
    // deduped + sorted so re-pushes don't drift the field value.
    const sortedHandles = [
      ...new Set(contributions.flatMap((c) => c.datasourceTemplateHandles)),
    ].sort((a, b) => a.localeCompare(b));
    operations.push({
      op: "SetField",
      policy,
      label: `shared-data-folder-insert-options:${subfolder}`,
      itemRefKey: sharedDataFolderStandardValuesId(site, subfolder),
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
 * Walk recipes once for the site-data-root union. Mirrors the template
 * selection in `emitSiteDataFolderTemplate` /`emitSiteSubfolderPool`
 * exactly — every ref this aggregate emits must name a template some
 * per-recipe compile actually creates:
 *
 *   - shared subfolder (≥2 recipes)      → shared `<Subfolder> Data Folder`
 *   - singleton WITH `allowedTemplates`  → per-LOCATION template
 *   - singleton WITHOUT                  → legacy per-RECIPE template
 */
const collectSiteDataRootMembers = (
  recipes: readonly Recipe[],
  sharedSubfolders: ReadonlySet<string>
): {
  legacySingletonHandles: string[];
  perLocationRefs: { recipeHandle: string; subfolder: string }[];
  sharedSubfolderRefs: string[];
  hasAny: boolean;
} => {
  const legacySingletonHandles = new Set<string>();
  const perLocationKeys = new Set<string>();
  const perLocationRefs: { recipeHandle: string; subfolder: string }[] = [];
  const sharedSubfolderRefs = new Set<string>();
  let hasAny = false;
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    for (const location of recipe.datasource?.locations ?? []) {
      if (location.scope !== "site" || !location.subfolder) continue;
      hasAny = true;
      if (sharedSubfolders.has(location.subfolder)) {
        sharedSubfolderRefs.add(location.subfolder);
      } else if ((location.allowedTemplates ?? []).length > 0) {
        const key = `${recipe.handle}::${location.subfolder}`;
        if (!perLocationKeys.has(key)) {
          perLocationKeys.add(key);
          perLocationRefs.push({ recipeHandle: recipe.handle, subfolder: location.subfolder });
        }
      } else {
        legacySingletonHandles.add(recipe.handle);
      }
    }
  }
  perLocationRefs.sort((a, b) =>
    `${a.recipeHandle}::${a.subfolder}`.localeCompare(`${b.recipeHandle}::${b.subfolder}`)
  );
  return {
    legacySingletonHandles: [...legacySingletonHandles].sort((a, b) => a.localeCompare(b)),
    perLocationRefs,
    sharedSubfolderRefs: [...sharedSubfolderRefs].sort((a, b) => a.localeCompare(b)),
    hasAny,
  };
};

/**
 * Build the synthetic IR materialising the site Data folder ROOT's
 * `__Standard Values` item, with Insert Options aggregating: the generic
 * Folder template, every per-recipe singleton `<Component> Data Folder`
 * template, and every shared `<Subfolder> Data Folder` template. Returns
 * null when there are zero contributing recipes or `contentItemsRoot` is
 * unset.
 */
export const buildSiteDataRootAggregate = (
  recipes: readonly Recipe[],
  sharedSubfolders: ReadonlySet<string>,
  context: CompileContext,
  site: string
): OperationIr | null => {
  if (!context.contentItemsRoot) return null;

  const { legacySingletonHandles, perLocationRefs, sharedSubfolderRefs, hasAny } =
    collectSiteDataRootMembers(recipes, sharedSubfolders);
  if (!hasAny) return null;

  const policy = defaultPolicyForRecipe("component-template");
  const svRefKey = siteDataRootStandardValuesId(site);
  const svPath = joinPath(context.contentItemsRoot, "__Standard Values");

  const refKeys: string[] = [
    SITECORE_TEMPLATES.FOLDER,
    ...legacySingletonHandles.map((handle) => siteDataFolderTemplateId(site, handle)),
    ...perLocationRefs.map(({ recipeHandle, subfolder }) =>
      siteDataFolderTemplateIdForLocation(site, recipeHandle, subfolder)
    ),
    ...sharedSubfolderRefs.map((subfolder) => sharedDataFolderTemplateId(site, subfolder)),
  ];

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: SITE_DATA_ROOT_AGGREGATE_HANDLE,
    operations: [
      {
        op: "CreateItem",
        policy: "CreateOnly",
        label: `site-data-root-standard-values:${site}`,
        id: svRefKey,
        path: svPath,
        parent: { kind: "ref-path", value: context.contentItemsRoot },
        templateOf: SITECORE_TEMPLATES.FOLDER,
        name: "__Standard Values",
        fields: [],
      } satisfies CreateItemOp,
      {
        op: "SetField",
        policy,
        label: `site-data-root-insert-options:${site}`,
        itemRefKey: svRefKey,
        fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
        value: { kind: "ref-recipe-list", refKeys },
      } satisfies SetFieldOp,
    ],
  });
};

/**
 * Build the synthetic IR materialising the enumerations root's
 * `__Standard Values` item + Insert Options aggregating the generic
 * Folder template plus every per-recipe `enumerationFolderId(site,
 * handle)`. Returns null when there are zero `EnumerationRecipe`s or
 * `enumerationsRoot` is unset.
 */
export const buildEnumerationsRootAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext,
  site: string
): OperationIr | null => {
  if (!context.enumerationsRoot) return null;

  const handles: string[] = [];
  for (const recipe of recipes) {
    if (recipe.kind === "enumeration") handles.push(recipe.handle);
  }
  if (handles.length === 0) return null;

  const sortedHandles = [...handles].sort((a, b) => a.localeCompare(b));
  const policy = defaultPolicyForRecipe("enumeration");
  const rootRefKey = enumerationsRootId(site);
  const svRefKey = enumerationsRootStandardValuesId(site);
  const svPath = joinPath(context.enumerationsRoot, "__Standard Values");

  const lastSlash = context.enumerationsRoot.lastIndexOf("/");
  const rootParentPath = context.enumerationsRoot.slice(0, lastSlash);
  const rootName = context.enumerationsRoot.slice(lastSlash + 1);

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: ENUMERATIONS_ROOT_AGGREGATE_HANDLE,
    operations: [
      // Explicit root item so the executor's path-walker doesn't
      // auto-create it as a generic Folder; stamps the enumeration glyph.
      {
        op: "CreateItem",
        policy,
        label: `enumerations-root:${site}`,
        id: rootRefKey,
        path: context.enumerationsRoot,
        parent: { kind: "ref-path", value: rootParentPath },
        templateOf: SITECORE_TEMPLATES.FOLDER,
        name: rootName,
        fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: ENUMERATION_ICON })],
      } satisfies CreateItemOp,
      {
        op: "CreateItem",
        policy: "CreateOnly",
        label: `enumerations-root-standard-values:${site}`,
        id: svRefKey,
        path: svPath,
        parent: { kind: "ref-recipe", refKey: rootRefKey },
        templateOf: SITECORE_TEMPLATES.FOLDER,
        name: "__Standard Values",
        fields: [],
      } satisfies CreateItemOp,
      {
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
      } satisfies SetFieldOp,
    ],
  });
};

/**
 * Build the synthetic IR materialising the shared enumeration TEMPLATE
 * trio (`Enumerations Folder` / `Enumeration` / `Enumeration Value`), their
 * inner Value fields, and their `__Standard Values` + Insert Options —
 * emitted ONCE for the whole set under the stable
 * `__enumeration-templates__` handle instead of by whichever enum recipe
 * compiled first. Returns null when the set declares no `EnumerationRecipe`.
 *
 * Reuses `ensureEnumerationTemplates` with a fresh sentinel set so the op
 * sequence stays byte-for-byte identical to the legacy per-recipe emission
 * (only the owning IR handle changes). `compileRecipeSet` PRE-SEEDS the
 * per-recipe sentinel (see `enumerationTemplatesSentinel`) so the per-recipe
 * pass resolves refKeys only and does not re-emit these ops.
 */
export const buildEnumerationTemplatesAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext,
  site: string
): OperationIr | null => {
  if (!recipes.some((r) => r.kind === "enumeration")) return null;

  const operations: Operation[] = [];
  // Fresh set → force emission (the aggregate is the single emitter).
  ensureEnumerationTemplates(operations, context, site, new Set());
  if (operations.length === 0) return null;

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: ENUMERATION_TEMPLATES_AGGREGATE_HANDLE,
    operations,
  });
};

/**
 * Build the synthetic IR materialising the SECTION-INDEPENDENT shared
 * organisational folders once for the whole set, under the stable
 * `__shared-folders__` handle: enumeration grouping folders
 * (`location.folder`), Content Models group folders, and Page Templates
 * group folders (`meta.tax.group`). Returns null when the set declares none.
 *
 * Reuses the same `ensure*` helpers the per-recipe pass calls, with a fresh
 * dedup set so emission is byte-for-byte identical (only the owning IR
 * handle changes) and shared prefixes/groups coalesce within the aggregate.
 * `compileRecipeSet` pre-seeds the emitted refKeys into the per-recipe
 * `emittedFolders` so the per-recipe `ensure*` calls short-circuit to
 * refKey-only. Keys are collected sorted so emission order is deterministic.
 *
 * Enumeration grouping folders conform to the shared `Enumerations Folder`
 * template (created by the `__enumeration-templates__` aggregate), so this
 * aggregate must apply AFTER it — `compileRecipeSet` orders the FRONT
 * unshifts accordingly.
 */
export const buildSharedFoldersAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext,
  site: string
): OperationIr | null => {
  const operations: Operation[] = [];
  // Fresh set → force emission (this aggregate is the sole emitter); it also
  // dedups shared prefixes/groups across recipes within the aggregate.
  const emitted = new Set<string>();

  // Enumeration grouping folders (`location.folder`).
  if (context.enumerationsRoot) {
    const folderTemplateRefKey = enumerationsFolderTemplateId(site);
    const enumFolderPaths = [
      ...new Set(
        recipes
          .filter((r): r is Extract<Recipe, { kind: "enumeration" }> => r.kind === "enumeration")
          .map((r) => r.location?.folder)
          .filter((f): f is string[] => Array.isArray(f) && f.length > 0)
          .map((f) => f.join("/"))
      ),
    ].sort((a, b) => a.localeCompare(b));
    for (const joined of enumFolderPaths) {
      ensureEnumerationGroupingFolders(
        operations,
        context,
        joined.split("/"),
        folderTemplateRefKey,
        emitted
      );
    }
  }

  // Content Models group folders (`meta.tax.group`).
  const contentGroups = [
    ...new Set(
      recipes
        .filter(
          (r): r is Extract<Recipe, { kind: "content-template" }> => r.kind === "content-template"
        )
        .map((r) => r.meta?.tax?.group)
        .filter((g): g is string => typeof g === "string" && g.length > 0)
    ),
  ].sort((a, b) => a.localeCompare(b));
  for (const group of contentGroups) {
    ensureContentModelsGroupFolder(operations, context, group, emitted);
  }

  // Page Templates group folders (`meta.tax.group`).
  const pageGroups = [
    ...new Set(
      recipes
        .filter((r): r is Extract<Recipe, { kind: "page-template" }> => r.kind === "page-template")
        .map((r) => r.meta?.tax?.group)
        .filter((g): g is string => typeof g === "string" && g.length > 0)
    ),
  ].sort((a, b) => a.localeCompare(b));
  for (const group of pageGroups) {
    ensurePageTemplatesGroupFolder(operations, context, group, emitted);
  }

  if (operations.length === 0) return null;

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: SHARED_FOLDERS_AGGREGATE_HANDLE,
    operations,
  });
};

/** One unique placeholder key collected across the recipe set. */
interface PlaceholderDecl {
  key: string;
  /** Sitecore item name under the placeholder settings root. */
  name: string;
  displayName: string;
  icon?: string;
  /** Optional grouping folder segments under the root (normalised by schema). */
  folder?: string[];
  /** `component-template` handles allowed in this placeholder. */
  allowed: Set<string>;
}

/**
 * Derive a Sitecore item name from a placeholder key. Keys carry shapes
 * item names can't (`/header`, `headless-main-{*}`); this strips the
 * leading slash, drops `{…}` dynamic segments, and collapses remaining
 * slashes to hyphens. Used only for inline `placeholders` slots.
 */
const placeholderItemName = (key: string): string => {
  const cleaned = trimEndChar(
    key
      .replace(/^\/+/, "")
      .replace(/\{[^{}]*\}/g, "")
      .replace(/\/+/g, "-"),
    "-"
  ).trim();
  return cleaned.length > 0 ? cleaned : "placeholder";
};

/** Collect every recipe-defined placeholder key + its resolved allow-set + metadata. */
const collectPlaceholderDecls = (recipes: readonly Recipe[]): Map<string, PlaceholderDecl> => {
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
        // Inline displayName / folder only fill in when nothing better is
        // set (a PlaceholderRecipe for the same key wins).
        if (slot.displayName && decl.displayName === decl.key) decl.displayName = slot.displayName;
        if (slot.folder && decl.folder === undefined) decl.folder = slot.folder;
        // Accept both `allowedComponents` and the registry alias
        // `allowedRenderingHandles` (see resolveAllowedHandles).
        for (const handle of resolveAllowedHandles(slot)) decl.allowed.add(handle);
      }
    }
  }

  // `placedIn` entries naming a recipe-defined key contribute that
  // component to the key's whitelist. Keys with no declaration are
  // skipped (left to the runtime placeholder-allow task).
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    for (const key of recipe.placedIn ?? []) byKey.get(key)?.allowed.add(recipe.handle);
  }

  return byKey;
};

/**
 * Resolve a placeholder `folder` path into a parent ref + base path,
 * emitting one CreateOnly grouping folder per segment (deduped via
 * `emittedFolders`). Each folder conforms to the SXA `Placeholder
 * Settings Folder` template so it inherits its Insert Options whitelist.
 */
const resolveFolderParent = (
  folder: string[] | undefined,
  root: string,
  site: string,
  emittedFolders: Set<string>,
  operations: Operation[]
): { parent: CreateItemOp["parent"]; basePath: string } => {
  let parentPath = root;
  let parentRef: CreateItemOp["parent"] = { kind: "ref-path", value: root };
  let cumulative = "";
  for (const segment of folder ?? []) {
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
        fields: [],
      } satisfies CreateItemOp);
    }
    parentPath = folderPath;
    parentRef = { kind: "ref-recipe", refKey: folderRefKey };
  }
  return { parent: parentRef, basePath: parentPath };
};

/**
 * Build the synthetic IR materialising the Placeholder Settings items for
 * the recipe set — one `CreateItem` + `SetField(Allowed Controls)` per
 * unique placeholder key (standalone `PlaceholderRecipe` + inline
 * `ComponentTemplateRecipe.placeholders`). `folder`s nest the item under
 * deduped grouping folders.
 *
 * Returns null when the set declares no placeholders. Throws
 * INPUT_INVALID when it declares placeholders but `placeholderSettingsRoot`
 * is unconfigured.
 */
export const buildPlaceholderSettingsAggregate = (
  recipes: readonly Recipe[],
  context: CompileContext,
  site: string
): OperationIr | null => {
  const byKey = collectPlaceholderDecls(recipes);
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

  const root = context.placeholderSettingsRoot;
  const policy = defaultPolicyForRecipe("placeholder");
  const operations: Operation[] = [];
  const emittedFolders = new Set<string>();

  for (const key of [...byKey.keys()].sort((a, b) => a.localeCompare(b))) {
    const decl = byKey.get(key)!;
    const refKey = placeholderSettingsId(site, key);
    const { parent, basePath } = resolveFolderParent(
      decl.folder,
      root,
      site,
      emittedFolders,
      operations
    );
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
