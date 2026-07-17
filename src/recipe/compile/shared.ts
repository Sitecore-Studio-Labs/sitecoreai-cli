import {
  componentFoldersBucketId,
  contentItemId,
  contentModelsGroupFolderId,
  enumerationContainerSectionId,
  enumerationContainerValueFieldId,
  enumerationFolderId,
  enumerationsFolderTemplateId,
  enumerationsFolderTemplateStandardValuesId,
  enumerationTemplateId,
  enumerationTemplateSectionId,
  enumerationTemplateStandardValuesId,
  enumerationTemplateValueFieldId,
  enumerationValueTemplateId,
  enumValueId,
  fieldId,
  pageTemplatesGroupFolderId,
  presentationDesignParametersBucketId,
  renderingsSectionFolderId,
  sectionFolderId,
  sectionId,
  mediaFieldId,
  standardValuesId,
  templateId,
} from "../items/guids";
import {
  type AddItemVersionOp,
  type CreateItemOp,
  type FieldValue,
  type MediaUploadOp,
  type Operation,
  type PushPolicy,
  type RefValue,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "../ir/operations";
import { createScaiError } from "../../shared/errors";
import { trimEndChar } from "../../shared/strings";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  ENUMERATION_ICON,
  FOLDER_ICON,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../ir/sitecore-templates";
import { type FieldDefinition, type DesignParameter } from "../schema/recipe";
import {
  defaultSitecoreFieldType,
  type SitecoreFieldType,
  sitecoreFieldTypeLabel,
} from "../schema/field-types";
import {
  applyMarketplacePluginOverride,
  augmentSourceToFields,
  renderSourceFields,
  sourceFieldsNeedHandleResolution,
} from "../schema/source-fields";

/**
 * Where a recipe's items land in the Sitecore content tree. Tenant-side
 * config — recipes themselves are tenant-agnostic. The compiler emits
 * deterministic Sitecore paths (`<templatesRoot>/<recipe.name>`, etc.)
 * that the executor resolves to server-assigned itemIds at runtime.
 */
export interface CompileContext {
  /**
   * Legacy flat templates root, e.g. `/sitecore/templates/Project/<site>`.
   * The component template, parameters template, and (when present)
   * Component Folder template land directly under this when `section`
   * is omitted. When `section` is set on a `ComponentTemplateRecipe`,
   * the compiler instead nests under the configured `componentsRoot`
   * (preferred) or — fallback — under `templatesRoot/<section>`.
   *
   * Required for back-compat with callers that haven't migrated to the
   * site-folder layout.
   */
  templatesRoot: string;
  /**
   * Renderings root. With `section`, the rendering lands at
   * `<renderingsRoot>/<section>/<Component>`. Without section, falls
   * back to the legacy flat `<renderingsRoot>/<Component>`.
   */
  renderingsRoot: string;
  /**
   * Per-site Components bucket — `/sitecore/templates/Project/<site>/Components`.
   * When set AND a `ComponentTemplateRecipe` carries a `section`, the
   * compiler emits at `<componentsRoot>/<section>/<Component>` and
   * companion paths (Component Folders / Presentation Parameters)
   * also nest under the section. When unset, the compiler falls back
   * to `templatesRoot` for back-compat with the flat layout.
   *
   * Optional today; will become the canonical input once the
   * orchestrator's `buildRecipeRoots()` returns the new bucket-roots
   * shape (see `plans/recipe-site-folder-layout.md`).
   */
  componentsRoot?: string;
  /**
   * Per-site Content Models bucket —
   * `/sitecore/templates/Project/<site>/Content Models`. When set AND a
   * `ContentTemplateRecipe` is being compiled, the template lands at
   * `<contentModelsRoot>/<group>/<name>` (when the recipe carries
   * `meta.tax.group`) or flat at `<contentModelsRoot>/<name>` otherwise.
   * When unset, the compiler falls back to `templatesRoot`.
   */
  contentModelsRoot?: string;
  /**
   * Required for `PartialDesignRecipe` compilation. Where the
   * partial-design items land — typically
   * `/sitecore/content/<site>/Presentation/Partial Designs`.
   * Optional in the type so original callers don't have to set it; the
   * partial-design compiler errors with a clear message if absent.
   */
  partialDesignsRoot?: string;
  /**
   * Required for `PageDesignRecipe` compilation. Where the
   * page-design items land — typically
   * `/sitecore/content/<site>/Presentation/Page Designs`.
   *
   * The page-design compiler also emits a SetField op writing
   * `TemplatesMapping` on this root item itself. The executor resolves
   * the root item's GUID via a pre-seeded `crossRecipeRefs` entry the
   * orchestrator pipeline-step provides at runtime.
   */
  pageDesignsRoot?: string;
  /**
   * Required for `ContentItemRecipe` compilation. Where shared
   * content items land — typically `/sitecore/content/<tenant>/<site>/Data`
   * or a sub-bucket for SXA sites. ContentItemRecipes encode `kind: "shared"`
   * datasource targets referenced from partial / page design layouts.
   */
  contentItemsRoot?: string;
  /**
   * Media-library folder under which recipe-materialised media items
   * land (external-URL image field values / SV image defaults compile
   * to a MediaUpload + `media-xml-ref` — see `externalImageMediaRef`).
   * Typically `/sitecore/media library/Project/<siteCollection>/<site>`.
   *
   * Optional. When unset the compiler falls back to the flat
   * `/sitecore/media library/RecipeImages/<site>` bucket. Each upload
   * still nests under `<recipeName>/` within the configured root; a
   * per-value `mediaLibraryFolder` on an image field overrides the root
   * entirely for that one image.
   */
  mediaLibraryRoot?: string;
  /**
   * Brand image-defaults map (role → external URL) supplied at push
   * time (`--image-defaults <file.json>` / `SITECOREAI_IMAGE_DEFAULTS`).
   * Image values and SV defaults that declare a `role` present in this
   * map materialise the mapped URL instead of the recipe-authored one,
   * so one brand-agnostic recipe yields brand-appropriate media per
   * install. Absent → recipe defaults apply unchanged.
   */
  imageDefaults?: Readonly<Record<string, string>>;
  /**
   * Languages available on the target environment — the Sites API
   * `listLanguages` set (matched by `iso` and `regionalIsoCode`), the
   * same source the brand-kit Glossary reads for its locales.
   *
   * When set, `compileDictionaryRecipe` filters each phrase's
   * translation locales to this set: the dictionary materialises only
   * the language versions the environment actually has, so a brand gets
   * exactly its languages and a push never tries to add a version in an
   * unregistered language (which the Authoring API rejects). The primary
   * locale is always emitted (the default-language fallback). Locale
   * comparison is case-insensitive.
   *
   * When unset (standalone compile, or a push that couldn't resolve the
   * language list), every authored translation is emitted — the
   * pre-filter behaviour, so nothing regresses for callers without a
   * live tenant.
   */
  availableLanguages?: readonly string[];
  /**
   * Required for `SiteTemplateRecipe` compilation. Where SXA
   * Site Template items land — typically `/sitecore/templates/Project/<brand>`
   * or a sub-folder for module groupings. Site templates are reusable
   * brand-shape definitions; `SiteRecipe` instances reference one via
   * `siteTemplate` and the Sites API instantiates it.
   */
  siteTemplatesRoot?: string;
  /**
   * Site name — e.g. `solterra`. Drives deterministic refKeys for
   * site-scoped folders (section folders, Component Folders subfolders,
   * Presentation Parameters subfolders, Content Models group folders).
   * When unset, folder-creation ops fall back to a `default` site name
   * to keep refKeys stable; production callers should always set this.
   */
  site?: string;
  /**
   * Content-tree path segment for the active site —
   * `<siteCollection>/<siteName>` (e.g. `Solterra Collection/solterra`).
   * Substituted for `{site}` in a `PageRecipe.itemPath`, yielding the
   * SXA Headless page path `/sitecore/content/<collection>/<site>/…`.
   *
   * Deliberately DISTINCT from `site` above: `site` seeds deterministic
   * GUIDs (opt-in via `siteScopedGuids`, defaults to the `default`
   * sentinel so GUIDs stay stable), while this is the real tenant tree
   * location. Compiling a `{site}` itemPath without this configured
   * throws INPUT_INVALID — the old behaviour silently substituted the
   * GUID seed and pages landed in a phantom `/sitecore/content/default/`
   * tree that no site serves.
   */
  sitePathSegment?: string;
  /**
   * SXA Headless variants root, e.g.
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants`.
   * Each component-template recipe's variants land at
   * `<headlessVariantsRoot>/<section>/<Component>/<Variant>` and conform
   * to the SXA `Variant Definition` template. The two grouping levels
   * (section + per-component) use `HeadlessVariantsGrouping` and
   * `HeadlessVariants` respectively.
   *
   * Required for any recipe that declares `variants`. The compiler
   * throws INPUT_INVALID before emitting variant ops if it's missing —
   * the legacy "variants nested under the rendering item" location no
   * longer matches SXA Headless and is no longer supported.
   */
  headlessVariantsRoot?: string;
  /**
   * Enumerations root, e.g.
   * `/sitecore/content/<siteCollection>/<site>/Settings/Enumerations`.
   * Each `EnumerationRecipe` lands at `<enumerationsRoot>/<EnumName>`
   * with one child item per value. Required for `EnumerationRecipe`
   * compilation; required for `ComponentTemplateRecipe`/
   * `DesignParametersTemplateRecipe` compilation when any field carries
   * `sitecore.enumHandle`. Compiler throws INPUT_INVALID with a clear
   * message when needed but missing.
   */
  enumerationsRoot?: string;
  /**
   * Cross-recipe signal populated by `compileRecipeSet` when two or more
   * `ComponentTemplateRecipe`s in the set declare site-scoped datasource
   * locations against the same `subfolder`. Membership flips per-recipe
   * Data Folder template emission OFF (the coalescer emits a SHARED
   * template instead) and changes the folder ITEM's `templateOf` to point
   * at `sharedDataFolderTemplateId(site, subfolder)`.
   *
   * Optional. Standalone callers of `compileComponentTemplateRecipe`
   * leave this unset — every site-scoped subfolder is treated as a
   * singleton (per-recipe template owns the folder), preserving the
   * pre-coalescer behaviour.
   */
  sharedSubfolders?: ReadonlySet<string>;
  /**
   * Cross-recipe map of section handles → `ComponentSectionRecipe`,
   * populated by `compileRecipeSet` from every `component-section`
   * recipe in the input. `compileComponentTemplateRecipe` uses this to
   * resolve `recipe.section.handle` → section name (for path
   * computation) and to validate the reference exists (else
   * INPUT_INVALID).
   *
   * Optional. Standalone callers of `compileComponentTemplateRecipe`
   * leave this unset; the per-recipe compiler then errors on any
   * `recipe.section` reference, since there's no way to resolve it.
   */
  sectionsByHandle?: ReadonlyMap<string, import("../schema/recipe").ComponentSectionRecipeParsed>;
  /**
   * Cross-recipe map of enumeration handles → `EnumerationRecipe`,
   * populated by `compileRecipeSet` from every `enumeration` recipe in
   * the input. Field compilers (`buildFieldOp` → `resolveFieldSource`)
   * use this to resolve `sitecore.enumHandle` → the enum folder's
   * tenant path, so Droplink Source values are emitted as content paths
   * (which SXA Headless's rendering parameter dialog enumerates) rather
   * than `{GUID}` references (which it doesn't honour for Droplink
   * Source).
   *
   * Optional. Standalone callers leave it unset; the field compiler
   * then errors on any `sitecore.enumHandle` reference, since there's
   * no way to resolve the folder path.
   */
  enumsByHandle?: ReadonlyMap<string, import("../schema/recipe").EnumerationRecipeParsed>;
  /**
   * Cross-recipe map of component handles → `ComponentTemplateRecipe`,
   * populated by `compileRecipeSet`. `compilePageRecipe` uses it to
   * resolve a scoped placement's component to its datasource template:
   * `datasource.template.handle` when the component declares a separate
   * content template, else the component template itself. Absent for
   * standalone single-recipe compiles — the page compiler then assumes
   * the component template is its own datasource template.
   */
  componentsByHandle?: ReadonlyMap<
    string,
    import("../schema/recipe").ComponentTemplateRecipeParsed
  >;
  /**
   * Cross-recipe map of content-template handles → `ContentTemplateRecipe`,
   * populated by `compileRecipeSet`. The inline-children materialiser
   * (`compile/inline-children.ts`) uses it — together with
   * `componentsByHandle` — to look up a treelist/multilist field's
   * definition on an EXTERNAL datasource template so an inline array of
   * child items resolves its child template via the field's
   * `sitecore.source.types`. Absent for standalone single-recipe
   * compiles — inline child arrays then only resolve against the
   * component's own fields.
   */
  contentTemplatesByHandle?: ReadonlyMap<
    string,
    import("../schema/recipe").ContentTemplateRecipeParsed
  >;
  /**
   * Every `DesignParametersTemplateRecipe` in the set, keyed by handle.
   * The page compiler consults this (via a component's external
   * `parameters: { handle }` reference) to type-map layout `par` values
   * — enum-backed Droplink params must carry enum-value item GUIDs, and
   * checkbox params `1`/`""`, for Pages' properties panel to display
   * them as set. Absent for standalone compiles — params then pass
   * through as raw names.
   */
  parametersByHandle?: ReadonlyMap<
    string,
    import("../schema/recipe").DesignParametersTemplateRecipeParsed
  >;
  /**
   * SXA Available Renderings root, e.g.
   * `/sitecore/content/<siteCollection>/<site>/Presentation/Available Renderings`.
   * `compileRecipeSet` aggregates every component-template recipe by
   * `recipe.section`, emits one `Available Renderings` item per
   * section, and writes the section's renderings (as Sitecore-formatted
   * itemIds) into the `Renderings` multilist field. The SXA editor
   * reads this list when the user composes a page — without it, the
   * editor shows the global rendering list instead of a curated
   * per-section subset.
   *
   * Optional. When unset, compileRecipeSet skips the aggregation
   * entirely. Component-template recipes without `section` are also
   * skipped — there's no section to bucket them under.
   */
  availableRenderingsRoot?: string;
  /**
   * SXA Placeholder Settings root, e.g.
   * `/sitecore/content/<site>/Presentation/Placeholder Settings`. Where
   * `buildPlaceholderSettingsAggregate` creates the Placeholder Settings
   * items for every recipe-defined placeholder key (standalone
   * `PlaceholderRecipe` + inline `ComponentTemplateRecipe.placeholders`).
   *
   * Required when the recipe set contains any `PlaceholderRecipe` or any
   * component with inline `placeholders`; the aggregate throws
   * INPUT_INVALID with a clear hint when needed but missing.
   */
  placeholderSettingsRoot?: string;
  /**
   * Templates root for `PageTemplateRecipe` items, e.g.
   * `/sitecore/templates/Project/<site>`. Page templates land at
   * `<pageTemplatesRoot>/[<group>/]<name>`. Optional — falls back to
   * `templatesRoot` when unset.
   */
  pageTemplatesRoot?: string;
  /**
   * Site content-tree root under which `PageRecipe` items land —
   * typically `/sitecore/content/<tenant>/<site>` or its `Home`
   * subtree. Required for `PageRecipe` compilation; the compiler
   * throws INPUT_INVALID with a clear hint when a page recipe is in
   * the set but this is unset.
   */
  pagesRoot?: string;
  /**
   * Cross-recipe map of site handles → `SiteRecipe`, populated by
   * `compileRecipeSet` from every `site` recipe in the input.
   * `compileDictionaryRecipe` uses this to resolve `recipe.site` to
   * the host SiteRecipe so the dictionary can compose its content-tree
   * path under `<sitePath>/Dictionary/<recipe.name>`. Standalone
   * callers leave this unset; `compileDictionaryRecipe` then errors
   * unless `crossRecipeSitePaths` provides a direct path.
   */
  sitesByHandle?: ReadonlyMap<string, import("../schema/recipe").SiteRecipeParsed>;
  /**
   * Pre-resolved content-tree paths for sites referenced by
   * dictionaries — keyed by SiteRecipe handle. Used by orchestrator-
   * side wiring where the host site already exists on the tenant (not
   * in the recipe set) but its path is known. Overrides `sitesByHandle`
   * resolution when both are present.
   */
  crossRecipeSitePaths?: Record<string, string>;
  /**
   * Per-org overrides for marketplace plugin `app_id` UUIDs, keyed by
   * `plugin_key` — the recipe-side `source.id` on a `kind: "plugin"`
   * source. When a recipe's plugin reference has a matching entry, the
   * compiler swaps the recipe-side `defaultAppId` for the override
   * value before emitting the Sitecore Source field. Populated from
   * `RootConfiguration.marketplacePluginOverrides` (which the
   * orchestrator writes into `sitecoreai.cli.json` at recipe-sync
   * preflight). Absent/empty means every plugin source emits its
   * recipe-author `defaultAppId`.
   */
  marketplacePluginOverrides?: Record<string, string>;
}

export const PARAMS_SECTION_NAME = "Parameters";
export const DEFAULT_FIELDS_SECTION = "Content";

/**
 * Sort-order offset applied to synthesised rendering parameter fields
 * (inline `params:` on a component template, and standalone
 * `parameters-template` recipes). The SXA Headless params base templates
 * ship `RenderingIdentifier`, `Styles`, `GridParameters`, etc. with
 * `__Sortorder` values in the low hundreds; defaulting custom params to
 * `100`/`200`/… interleaves them with those inherited fields in the
 * Pages parameters dialog. Starting custom params at `1100` keeps them
 * grouped below the inherited standards while leaving room for
 * explicit `sitecore.sortOrder` overrides to slot anywhere.
 */
export const PARAMS_SORT_ORDER_BASE = 1000;

export const COMPONENT_FOLDERS_BUCKET = "Component Folders";
export const PRESENTATION_PARAMETERS_BUCKET = "Presentation Parameters";

export const joinPath = (parent: string, name: string): string => {
  const trimmed = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${trimmed}/${name}`;
};

/** Site name for deterministic folder refKeys. */
export const siteOf = (context: CompileContext): string => context.site ?? "default";

/**
 * The content-template handles a component's datasource items conform
 * to. Mirrors the rendering's `Datasource Template` field precedence
 * (`resolveDatasourceTemplateField` in component-template.ts): explicit
 * compatible-datasources list (`datasource.templates[]`) > single
 * external template (`datasource.template`) > the recipe's own handle
 * (inline-fields pattern — the component template IS the datasource
 * template).
 *
 * Every Insert Options list that restricts a data folder to "this
 * component's datasource type" MUST go through this helper: components
 * using the external-template patterns never create a
 * `templateId(site, recipe.handle)` item, so referencing the recipe's
 * own handle for them produces a refKey no CreateItem defines — the
 * executor then writes a literal broken GUID into the field.
 */
export const datasourceTemplateHandles = (
  recipe: import("../schema/recipe").ComponentTemplateRecipeParsed
): string[] => {
  const templates = recipe.datasource?.templates;
  if (templates?.length) return templates.map((t) => t.handle);
  if (recipe.datasource?.template) return [recipe.datasource.template.handle];
  return [recipe.handle];
};

/**
 * Resolve a `sitecore.enumHandle` reference to the tenant content path
 * the enumeration's folder lives at. Used by `resolveFieldSource` to
 * emit Droplink Source values as content paths (the form SXA Headless's
 * rendering parameter dialog accepts) rather than `{GUID}` references.
 *
 * Path shape:
 *   - With `location.folder` set →
 *     `<enumerationsRoot>/<folder>/<enum.name>`.
 *   - Without `location.folder` → `<enumerationsRoot>/<enum.name>` (flat).
 *
 * Throws INPUT_INVALID when the enum handle isn't in the recipe set
 * (author error: `sitecore.enumHandle` references something that
 * doesn't exist), or when `enumerationsRoot` is unset on the context.
 */
export const resolveEnumFolderPath = (
  context: CompileContext,
  enumHandle: string,
  consumerHandle: string
): string => {
  if (!context.enumerationsRoot) {
    throw createScaiError(
      `Recipe '${consumerHandle}' references sitecore.enumHandle='${enumHandle}' but no enumerationsRoot is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `enumerationsRoot` on the active envProfile in sitecoreai.cli.json.",
      }
    );
  }
  const enumRecipe = context.enumsByHandle?.get(enumHandle);
  if (!enumRecipe) {
    throw createScaiError(
      `Recipe '${consumerHandle}' references sitecore.enumHandle='${enumHandle}' but no EnumerationRecipe with that handle is in the set.`,
      "INPUT_INVALID",
      {
        hint: "Add an `EnumerationRecipe` (kind: 'enumeration') with the matching handle to the recipe set, or change the field's `sitecore.enumHandle` to point at an existing one.",
      }
    );
  }
  // `location.folder` is a `string[]` of grouping segments after the
  // schema's `FolderPath` normalisation — join with `/` here to build
  // the cumulative path under enumerationsRoot.
  const folderSegments = enumRecipe.location?.folder;
  return folderSegments && folderSegments.length > 0
    ? joinPath(joinPath(context.enumerationsRoot, folderSegments.join("/")), enumRecipe.name)
    : joinPath(context.enumerationsRoot, enumRecipe.name);
};

export function sharedField(fieldGuid: string, value: FieldValue["value"]): FieldValue {
  return { fieldId: fieldGuid, value };
}

export function versionedField(fieldGuid: string, value: FieldValue["value"]): FieldValue {
  return {
    fieldId: fieldGuid,
    language: DEFAULT_LANGUAGE,
    version: DEFAULT_VERSION,
    value,
  };
}

/**
 * Resolve the parent path under which a `ComponentTemplateRecipe`'s
 * template item lands.
 *
 *   - With section + componentsRoot → `<componentsRoot>/<section>` (new layout).
 *   - With section only → `<templatesRoot>/<section>` (mid-migration fallback).
 *   - Without section → `<templatesRoot>` (legacy flat layout).
 */
export const resolveComponentTemplateParent = (
  context: CompileContext,
  section: string | undefined
): string => {
  if (section) {
    if (context.componentsRoot) {
      return joinPath(context.componentsRoot, section);
    }
    return joinPath(context.templatesRoot, section);
  }
  return context.templatesRoot;
};

/**
 * Resolve the parent path for a Component Folder template — the
 * `<Component> Folder` items emitted when a recipe declares
 * `children:`. Always nested under
 * `<sectionRoot>/Component Folders/`.
 */
export const resolveComponentFoldersBucketPath = (
  context: CompileContext,
  section: string
): string => joinPath(resolveComponentTemplateParent(context, section), COMPONENT_FOLDERS_BUCKET);

/**
 * Resolve the parent path for a Presentation Parameters template —
 * `<sectionRoot>/Presentation Parameters/`. When the recipe lacks a
 * section (legacy callers), parameters templates land directly under
 * `templatesRoot` to match the old flat layout.
 */
export const resolvePresentationDesignParametersBucketPath = (
  context: CompileContext,
  section: string | undefined
): string => {
  if (!section) {
    return context.templatesRoot;
  }
  return joinPath(resolveComponentTemplateParent(context, section), PRESENTATION_PARAMETERS_BUCKET);
};

/**
 * Resolve the parent path for the rendering item.
 *
 *   - With section → `<renderingsRoot>/<section>/<Component>`.
 *   - Without → legacy flat `<renderingsRoot>/<Component>`.
 */
export const resolveRenderingParent = (
  context: CompileContext,
  section: string | undefined
): string => (section ? joinPath(context.renderingsRoot, section) : context.renderingsRoot);

/**
 * Ensure a section folder (under `componentsRoot/<section>`) exists.
 * Idempotent: emits a CreateOnly CreateItem op the first time a given
 * (site, section) pair is seen and records the refKey in the
 * `emittedFolders` set so subsequent calls are no-ops.
 *
 * Returns the section folder's refKey for downstream callers that want
 * to nest items under it.
 */
export const ensureSectionFolder = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = sectionFolderId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);

  const parent = context.componentsRoot ?? context.templatesRoot;
  const path = joinPath(parent, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `section-folder:${site}:${section}`,
    id: refKey,
    path,
    parent: { kind: "ref-path", value: parent },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: section,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a "Component Folders" subfolder exists under the section
 * folder. Idempotent.
 */
export const ensureComponentFoldersBucket = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = componentFoldersBucketId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const sectionRefKey = ensureSectionFolder(operations, context, section, emittedFolders);
  const parentPath = resolveComponentTemplateParent(context, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `component-folders-bucket:${site}:${section}`,
    id: refKey,
    path: joinPath(parentPath, COMPONENT_FOLDERS_BUCKET),
    parent: { kind: "ref-recipe", refKey: sectionRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: COMPONENT_FOLDERS_BUCKET,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a "Presentation Parameters" subfolder exists under the section
 * folder. Idempotent.
 */
export const ensurePresentationDesignParametersBucket = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = presentationDesignParametersBucketId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const sectionRefKey = ensureSectionFolder(operations, context, section, emittedFolders);
  const parentPath = resolveComponentTemplateParent(context, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `presentation-parameters-bucket:${site}:${section}`,
    id: refKey,
    path: joinPath(parentPath, PRESENTATION_PARAMETERS_BUCKET),
    parent: { kind: "ref-recipe", refKey: sectionRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: PRESENTATION_PARAMETERS_BUCKET,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a section subfolder under the renderings tree exists —
 * `<renderingsRoot>/<section>/`. Mirrors the templates side; the
 * rendering tree shape mirrors the template tree per the layout plan.
 */
export const ensureRenderingsSectionFolder = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = renderingsSectionFolderId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const path = joinPath(context.renderingsRoot, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `renderings-section-folder:${site}:${section}`,
    id: refKey,
    path,
    parent: { kind: "ref-path", value: context.renderingsRoot },
    // Real SXA renderings-tree section folders use `Rendering Folder`,
    // not the generic `Folder` template. Verified against live tenant
    // 2026-05-02 — every section under
    // `/sitecore/layout/Renderings/Project/<site>/` conforms to this.
    templateOf: SITECORE_TEMPLATES.RENDERING_FOLDER,
    name: section,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a Content Models group folder exists. Returns the refKey for
 * downstream `CreateItem.parent` references. Idempotent across
 * repeated calls within one recipe-set compile.
 */
export const ensureContentModelsGroupFolder = (
  operations: Operation[],
  context: CompileContext,
  group: string,
  emittedFolders: Set<string>
): string | undefined => {
  if (!context.contentModelsRoot) return undefined;
  const site = siteOf(context);
  const refKey = contentModelsGroupFolderId(site, group);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const path = joinPath(context.contentModelsRoot, group);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `content-models-group-folder:${site}:${group}`,
    id: refKey,
    path,
    parent: { kind: "ref-path", value: context.contentModelsRoot },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: group,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a page-templates group folder exists under `<root>/<group>`,
 * where `<root>` is `pageTemplatesRoot` (falling back to `templatesRoot`).
 * Returns the refKey for `CreateItem.parent`, or `undefined` when no
 * root resolves. Idempotent across one recipe-set compile via
 * `emittedFolders`. Mirror of `ensureContentModelsGroupFolder` for the
 * page-template tree.
 */
export const ensurePageTemplatesGroupFolder = (
  operations: Operation[],
  context: CompileContext,
  group: string,
  emittedFolders: Set<string>
): string | undefined => {
  const root = context.pageTemplatesRoot ?? context.templatesRoot;
  if (!root) return undefined;
  const site = siteOf(context);
  const refKey = pageTemplatesGroupFolderId(site, group);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `page-templates-group-folder:${site}:${group}`,
    id: refKey,
    path: joinPath(root, group),
    parent: { kind: "ref-path", value: root },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: group,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Per-site SXA-style enumeration template trio. Three templates with
 * distinct roles — emitted as siblings under the site's
 * `Presentation/` templates folder:
 *
 *   Enumerations Folder        → folder layers in the enum content tree
 *                                (root, per-folder grouping items)
 *     └── __Standard Values    Insert Options: Enumeration + Enumerations Folder
 *
 *   Enumeration                → per-enum container items
 *                                (`Color Scheme`, `Heading Size`, etc.)
 *     └── __Standard Values    Insert Options: Enumeration Value
 *
 *   Enumeration Value          → leaf value items
 *                                (`primary`, `accent`, `lg`, `shooting-star`)
 *     └── Enumeration (section)
 *           └── Value (Single-Line Text, shared)
 *
 * All three inherit from Standard Template only and stamp the
 * `keyboard_key_e.png` icon so the SXA editor recognises enum items
 * as enumeration entries (not folders) without per-item icon overrides.
 *
 * The `Value` field on `Enumeration Value` carries each value item's
 * actual enumeration string (`"primary"`, `"shooting-star"`, etc.) —
 * the canonical SXA "picked item's Value field" payload that Droplink
 * consumers (XM Cloud Pages, JSS variants, custom Edge resolvers) read.
 *
 * Insert Options are wired so authors can right-click without picking
 * templates from a long list:
 *   - Inside an `Enumerations Folder` → Insert: `Enumeration` (typical)
 *     or `Enumerations Folder` (nesting, e.g. `Theme/Color`)
 *   - Inside an `Enumeration` → Insert: `Enumeration Value` only
 *   - Inside an `Enumeration Value` → no Insert Options (leaves)
 *
 * Idempotent across the recipe set — the templates are emitted on
 * first call and re-uses are no-ops via the shared `emittedFolders`
 * set. Returns the deterministic refKeys for all three templates +
 * the `Value` field so callers can wire `templateOf` and `Value` field
 * writes correctly.
 */
export interface EnumerationTemplateRefs {
  folderTemplateRefKey: string;
  /** Per-enum container template (Color Scheme, Heading Size, …). */
  enumerationTemplateRefKey: string;
  /**
   * RefKey of the `Value` Template Field under the *Enumeration*
   * template's inner `Enumeration` section. Carries each per-enum
   * container's canonical default (driven by `EnumerationRecipe.default`).
   * Distinct from `valueFieldRefKey` (which is on the Enumeration Value
   * template, for leaf items).
   */
  containerValueFieldRefKey: string;
  /** Leaf value template (primary, accent, lg, …). Carries the `Value` field. */
  valueTemplateRefKey: string;
  /**
   * RefKey of the `Value` Template Field under the Enumeration Value
   * template. Callers writing the field on individual value items pair
   * this with `fieldName: "Value"` so the executor's tenant-side
   * resolver can locate the field by name (recipe-derived field GUIDs
   * don't match the Sitecore-assigned ones).
   */
  valueFieldRefKey: string;
}

/**
 * The `emittedFolders` sentinel key guarding the shared enumeration
 * template trio's one-time emission. Exported so `compileRecipeSet` can
 * PRE-SEED it: when the whole set is compiled, the templates + their
 * `__Standard Values` are emitted once via the stable
 * `__enumeration-templates__` FRONT aggregate (owned by that synthetic
 * handle so tenant ownership never drifts between rebuilds), and every
 * per-recipe `ensureEnumerationTemplates` call short-circuits to
 * refKeys-only. A single-recipe compile (no set, fresh set) still emits
 * the templates inline so the IR stays self-contained.
 */
export const enumerationTemplatesSentinel = (site: string): string =>
  `enumeration-templates:${site}`;

export const ensureEnumerationTemplates = (
  operations: Operation[],
  context: CompileContext,
  site: string,
  emittedFolders: Set<string>
): EnumerationTemplateRefs => {
  const folderTemplateRefKey = enumerationsFolderTemplateId(site);
  const enumerationTemplateRefKey = enumerationTemplateId(site);
  const containerValueFieldRefKey = enumerationContainerValueFieldId(site);
  const valueTemplateRefKey = enumerationValueTemplateId(site);
  const valueFieldRefKey = enumerationTemplateValueFieldId(site);
  const sentinel = enumerationTemplatesSentinel(site);
  if (emittedFolders.has(sentinel)) {
    return {
      folderTemplateRefKey,
      enumerationTemplateRefKey,
      containerValueFieldRefKey,
      valueTemplateRefKey,
      valueFieldRefKey,
    };
  }
  emittedFolders.add(sentinel);

  // Enum templates live at the SITE templates root's `/Presentation`
  // bucket (sibling of `/Components`), NOT nested under `/Components`.
  // Orchestrators typically alias `templatesRoot` and `componentsRoot`
  // to the same `<siteRoot>/Components` value; strip the trailing
  // `/Components` segment from whichever is provided to land on the
  // site templates root. When the input doesn't end in `/Components`
  // (legacy flat layout), use it as-is.
  const root = context.componentsRoot ?? context.templatesRoot;
  const siteTemplatesRoot = root.replace(/\/Components$/, "");
  const parentPath = joinPath(siteTemplatesRoot, "Presentation");

  const templateEntries: ReadonlyArray<{ refKey: string; name: string }> = [
    { refKey: folderTemplateRefKey, name: "Enumerations Folder" },
    { refKey: enumerationTemplateRefKey, name: "Enumeration" },
    { refKey: valueTemplateRefKey, name: "Enumeration Value" },
  ];

  for (const { refKey, name } of templateEntries) {
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `enumeration-template:${site}:${name}`,
      id: refKey,
      path: joinPath(parentPath, name),
      parent: { kind: "ref-path", value: parentPath },
      templateOf: SITECORE_TEMPLATES.TEMPLATE,
      name,
      fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: ENUMERATION_ICON })],
    } satisfies CreateItemOp);

    operations.push({
      op: "SetBaseTemplates",
      policy: "CreateOnly",
      label: `enumeration-template-base:${site}:${name}`,
      itemRefKey: refKey,
      baseTemplates: [STANDARD_TEMPLATE_ID],
    } satisfies SetBaseTemplatesOp);
  }

  // Inner `Enumeration` Section + `Value` field — emitted on BOTH the
  // Enumeration template (for the per-enum container's default value)
  // and the Enumeration Value template (for each leaf value's payload).
  // Same field name + shape on both so Edge consumers query the same
  // way to read either the canonical default (off the container) or a
  // leaf payload (off a value item):
  //   `item.field("Value").value`.
  const innerValueFieldEntries: ReadonlyArray<{
    templatePath: string;
    templateRefKey: string;
    sectionRefKey: string;
    fieldRefKey: string;
    labelPrefix: string;
  }> = [
    {
      templatePath: joinPath(parentPath, "Enumeration"),
      templateRefKey: enumerationTemplateRefKey,
      sectionRefKey: enumerationContainerSectionId(site),
      fieldRefKey: containerValueFieldRefKey,
      labelPrefix: "enumeration-template",
    },
    {
      templatePath: joinPath(parentPath, "Enumeration Value"),
      templateRefKey: valueTemplateRefKey,
      sectionRefKey: enumerationTemplateSectionId(site),
      fieldRefKey: valueFieldRefKey,
      labelPrefix: "enumeration-value-template",
    },
  ];

  for (const e of innerValueFieldEntries) {
    const sectionPath = joinPath(e.templatePath, "Enumeration");
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `${e.labelPrefix}-section:${site}`,
      id: e.sectionRefKey,
      path: sectionPath,
      parent: { kind: "ref-recipe", refKey: e.templateRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      name: "Enumeration",
      fields: [],
    } satisfies CreateItemOp);

    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `${e.labelPrefix}-value-field:${site}`,
      id: e.fieldRefKey,
      path: joinPath(sectionPath, "Value"),
      parent: { kind: "ref-recipe", refKey: e.sectionRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      name: "Value",
      fields: [
        sharedField(TEMPLATE_FIELD_FIELDS.TYPE, {
          kind: "string",
          value: sitecoreFieldTypeLabel("single-line-text"),
        }),
        sharedField(SYSTEM_FIELDS.SORT_ORDER, { kind: "number", value: 100 }),
        sharedField(TEMPLATE_FIELD_FIELDS.SHARED, { kind: "string", value: "1" }),
        versionedField(TEMPLATE_FIELD_FIELDS.TITLE, { kind: "string", value: "Value" }),
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: "Value" }),
      ],
    } satisfies CreateItemOp);
  }

  // Standard Values + Insert Options for each template that authors can
  // insert into. Living at the template definition (not at every data
  // folder) keeps Droplink picker results clean — only real value items
  // appear, no stray __Standard Values siblings.
  const standardValuesEntries: ReadonlyArray<{
    templateRefKey: string;
    templateName: string;
    svRefKey: string;
    insertOptions: readonly string[];
  }> = [
    {
      templateRefKey: folderTemplateRefKey,
      templateName: "Enumerations Folder",
      svRefKey: enumerationsFolderTemplateStandardValuesId(site),
      // Folders contain enums (typical) or sub-folders (nesting via
      // multi-segment `folder: "Theme/Color"` recipes).
      insertOptions: [enumerationTemplateRefKey, folderTemplateRefKey],
    },
    {
      templateRefKey: enumerationTemplateRefKey,
      templateName: "Enumeration",
      svRefKey: enumerationTemplateStandardValuesId(site),
      // Per-enum items only contain values — never sub-enums or folders.
      insertOptions: [valueTemplateRefKey],
    },
  ];

  for (const entry of standardValuesEntries) {
    const svPath = joinPath(joinPath(parentPath, entry.templateName), "__Standard Values");
    operations.push({
      op: "CreateItem",
      policy: "CreateOnly",
      label: `enumeration-template-standard-values:${site}:${entry.templateName}`,
      id: entry.svRefKey,
      path: svPath,
      parent: { kind: "ref-recipe", refKey: entry.templateRefKey },
      templateOf: entry.templateRefKey,
      name: "__Standard Values",
      fields: [],
    } satisfies CreateItemOp);

    // SetStandardValues + Insert Options are recipe-controlled and
    // CreateAndUpdate so re-pushes always reconcile the link + the
    // Insert Options list — there's no "preserve CMS edit" case worth
    // honouring (authors edit the recipe, not the SV's __Masters field
    // directly), and CreateOnly was leaving stale values from earlier
    // broken pushes in place.
    operations.push({
      op: "SetStandardValues",
      policy: "CreateAndUpdate",
      label: `enumeration-template-link-standard-values:${site}:${entry.templateName}`,
      templateRefKey: entry.templateRefKey,
      standardValuesRefKey: entry.svRefKey,
    } satisfies SetStandardValuesOp);

    // `ref-recipe-list`, NOT `ref-guid-list` — the executor must
    // resolve each template refKey against the captured-itemId map to
    // the server-assigned itemId before rendering. `ref-guid-list`
    // emits refKey GUIDs verbatim; those are deterministic compile-time
    // values, not the actual tenant-side template IDs, so the resulting
    // `__Masters` value points at items that don't exist and the
    // editor's Insert menu silently has nothing to enumerate.
    operations.push({
      op: "SetField",
      policy: "CreateAndUpdate",
      label: `enumeration-template-insert-options:${site}:${entry.templateName}`,
      itemRefKey: entry.svRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: [...entry.insertOptions],
      },
    } satisfies SetFieldOp);
  }

  return {
    folderTemplateRefKey,
    enumerationTemplateRefKey,
    containerValueFieldRefKey,
    valueTemplateRefKey,
    valueFieldRefKey,
  };
};

export interface DatasourceTemplateInput {
  handle: string;
  name: string;
  displayName: string;
  fields: FieldDefinition[];
  insertOptions?: string[];
  /**
   * Where external-URL image DEFAULTS (Standard Values) land in the
   * media library. Site scope only — SVs are template-level, not
   * page-bound; `resolveMediaLocationFolder` rejects `scope: "page"`.
   */
  mediaLocation?: { scope: "page" | "site"; subfolder?: string };
  /**
   * Optional override for the template's parent path. When set, the
   * template lands at `<parentPath>/<name>` and `parent` resolves via
   * `ref-path`. When omitted, falls back to `context.templatesRoot`
   * for back-compat with the legacy flat layout.
   */
  parentPath?: string;
  /**
   * Optional override for the template's parent — when the parent has
   * already been emitted as a CreateItem op in this set (e.g. a section
   * folder), passing the refKey here lets the planner resolve via the
   * captured-itemId map without needing a path-based lookup. Mutually
   * exclusive with `parentPath`'s refKey-as-string semantics.
   */
  parentRefKey?: string;
  /**
   * Extra template GUIDs to append to the synthesised
   * `SetBaseTemplates` op (in addition to the implicit Standard
   * Template). Used by `compileComponentTemplateRecipe` to wire in the
   * SXA Foundation bases (`SXA_COMPONENT_BASE_TEMPLATES`) so the
   * resulting template is recognised as an SXA Headless component;
   * datasource-only callers (`compileContentTemplateRecipe`) leave it
   * unset so content templates stay shape-pure.
   */
  additionalBaseTemplates?: readonly string[];
  /**
   * Base templates resolved by TENANT PATH at apply time, forwarded to
   * the synthesised `SetBaseTemplates` op's `pathBases`. Used by
   * `compilePageTemplateRecipe` to inherit the SXA-scaffolded
   * `/sitecore/templates/Project/<collection>/Page` when the tenant has
   * one, with the raw SXA Foundation page facets as the fallback.
   */
  baseTemplatePathBases?: readonly { path: string; fallbackTemplates: string[] }[];
  /**
   * Drop the implicit Standard template from the synthesised
   * `SetBaseTemplates`. Set when `additionalBaseTemplates` already
   * chains Standard transitively (page templates: the SXA `Base Page`
   * facet carries it) — listing it explicitly is redundant noise in the
   * Content Editor's inheritance view. Callers using this MUST provide
   * a non-empty `additionalBaseTemplates` (base lists can't be empty).
   */
  omitStandardBaseTemplate?: boolean;
}

export function emitDatasourceTemplate(
  operations: Operation[],
  recipe: DatasourceTemplateInput,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const site = siteOf(context);
  const tplRefKey = templateId(site, recipe.handle);
  const parentPath = recipe.parentPath ?? context.templatesRoot;
  const tplPath = joinPath(parentPath, recipe.name);
  const parentRef: CreateItemOp["parent"] = recipe.parentRefKey
    ? { kind: "ref-recipe", refKey: recipe.parentRefKey }
    : { kind: "ref-path", value: parentPath };

  operations.push({
    op: "CreateItem",
    policy,
    label: `template:${recipe.handle}`,
    id: tplRefKey,
    path: tplPath,
    parent: parentRef,
    templateOf: SITECORE_TEMPLATES.TEMPLATE,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetBaseTemplates",
    policy,
    label: `base-templates:${recipe.handle}`,
    itemRefKey: tplRefKey,
    baseTemplates: [
      ...(recipe.omitStandardBaseTemplate ? [] : [STANDARD_TEMPLATE_ID]),
      ...(recipe.additionalBaseTemplates ?? []),
    ],
    ...(recipe.baseTemplatePathBases?.length
      ? { pathBases: recipe.baseTemplatePathBases.map((entry) => ({ ...entry })) }
      : {}),
  } satisfies SetBaseTemplatesOp);

  for (const group of groupFieldsBySection(recipe.fields)) {
    const secRefKey = sectionId(site, recipe.handle, group.section);
    const secPath = joinPath(tplPath, group.section);
    operations.push({
      op: "CreateItem",
      policy,
      label: `section:${recipe.handle}/${group.section}`,
      id: secRefKey,
      path: secPath,
      parent: { kind: "ref-recipe", refKey: tplRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      name: group.section,
      fields: [],
    } satisfies CreateItemOp);

    group.fields.forEach((field, index) => {
      operations.push(
        ...buildFieldOp({
          recipeHandle: recipe.handle,
          fieldRefKey: fieldId(site, recipe.handle, field.name),
          fieldPath: joinPath(secPath, field.name),
          parentRefKey: secRefKey,
          labelPrefix: `field:${recipe.handle}`,
          field,
          zeroBasedIndex: index,
          policy,
          site,
          context,
        })
      );
    });
  }

  const svRefKey = standardValuesId(site, recipe.handle);
  const svPath = joinPath(tplPath, "__Standard Values");
  // Image defaults with external URLs materialise as media items —
  // the MediaUpload ops must run BEFORE the SV CreateItem so the
  // executor has captured each media itemId when it resolves the
  // entries' `media-xml-ref` values.
  const svMediaLocationFolder = resolveMediaLocationFolder(recipe.mediaLocation, {
    context,
    site,
    recipeHandle: recipe.handle,
  });
  const svImageMediaSink: ImageMediaSink = {
    policy,
    mediaOps: [],
    ...(context.mediaLibraryRoot ? { mediaLibraryRoot: context.mediaLibraryRoot } : {}),
    ...(context.imageDefaults ? { imageDefaults: context.imageDefaults } : {}),
    ...(svMediaLocationFolder ? { locationFolder: svMediaLocationFolder } : {}),
  };
  const sv = buildStandardValuesFieldEntries(
    site,
    recipe.handle,
    recipe.fields,
    fieldId,
    svImageMediaSink,
    context.availableLanguages
  );
  operations.push(...svImageMediaSink.mediaOps);
  operations.push({
    op: "CreateItem",
    policy,
    label: `standard-values:${recipe.handle}`,
    id: svRefKey,
    path: svPath,
    parent: { kind: "ref-recipe", refKey: tplRefKey },
    // The SV item conforms to the template we just created — runtime
    // resolution turns this ref-recipe placeholder into the assigned id.
    templateOf: tplRefKey,
    name: "__Standard Values",
    // Per-field defaults from `field.default` / `field.sitecore.defaultValue`.
    // These pre-fill new datasource items so authors see meaningful
    // initial content instead of an empty form. Link defaults encode as
    // link XML; image defaults with external URLs resolve via the
    // MediaUpload ops emitted above. Locale-map defaults contribute the
    // primary-language version here; non-primary versions follow the
    // SetStandardValues link below.
    fields: sv.primary,
  } satisfies CreateItemOp);

  operations.push({
    op: "SetStandardValues",
    policy,
    label: `link-standard-values:${recipe.handle}`,
    templateRefKey: tplRefKey,
    standardValuesRefKey: svRefKey,
  } satisfies SetStandardValuesOp);

  // Per-language __Standard Values versions from locale-map defaults —
  // AddItemVersion + versioned SetField, after the SV item exists.
  emitStandardValuesLocaleVersions(
    operations,
    svRefKey,
    sv.localeVersions,
    policy,
    `standard-values:${recipe.handle}`
  );

  if (recipe.insertOptions && recipe.insertOptions.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `insert-options:${recipe.handle}`,
      itemRefKey: svRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: recipe.insertOptions.map((handle) => templateId(site, handle)),
      },
    } satisfies SetFieldOp);
  }
}

export interface BuildFieldOpInput {
  recipeHandle: string;
  fieldRefKey: string;
  fieldPath: string;
  parentRefKey: string;
  labelPrefix: string;
  field: FieldDefinition | DesignParameter;
  zeroBasedIndex: number;
  /**
   * Offset added to the auto-assigned `(zeroBasedIndex + 1) * 100` when
   * the field has no explicit `sitecore.sortOrder`. Default 0.
   *
   * Used by rendering parameters templates: the SXA Headless params base
   * templates ship `RenderingIdentifier`, `Styles`, `GridParameters`, etc.
   * at sortOrder values in the low hundreds. Inline `params:` would tie
   * or interleave with those on the inherited fields' `__Sortorder`,
   * making the Pages parameters dialog render custom params mixed in
   * between `id` and `css styles`. Passing a high base (e.g. `1000`)
   * pushes synthesised params cleanly below the inherited standards.
   */
  sortOrderBase?: number;
  policy: PushPolicy;
  /**
   * Site name the recipe set is being compiled under. Threaded through to
   * `resolveFieldSource` so the emitted `ref-source-fields` value carries
   * the site — the executor's resolver needs it to derive `templateId(site,
   * handle)` for handle references in `sourceTypes`.
   */
  site: string;
  /**
   * Compile context — used by `resolveFieldSource` to look up
   * `sitecore.enumHandle` references against `enumsByHandle` and emit
   * the enum's tenant content path as the Droplink Source value.
   * Standalone callers can omit it, but any field with
   * `sitecore.enumHandle` will then throw INPUT_INVALID since the path
   * can't be resolved.
   */
  context?: CompileContext;
}

/**
 * Build the CreateItem op for a single field definition.
 *
 * Always returns exactly one op — the field-definition item itself.
 * Backing storage for enum-shaped fields is decided by the field's
 * `sitecore.type` / `sitecore.enumHandle` and resolved into the
 * `Source` field via `resolveFieldSource`:
 *   - `sitecore.type: "droplist"` + inline `values: [...]` → Source is
 *     a pipe-separated literal; Sitecore enumerates the string directly,
 *     no value items needed.
 *   - `sitecore.enumHandle: "<handle>"` (Droplink default) → Source is
 *     the EnumerationRecipe's folder path on the tenant; the picker
 *     enumerates that path's children at editor time. The values live
 *     under the `EnumerationRecipe`'s folder item, emitted by
 *     `compileEnumerationRecipe`.
 *
 * Inline Droplink (`shape: "enum"` + inline `values` + no `enumHandle`
 * + no `sitecore.type` override) is rejected by `resolveFieldSource`
 * with INPUT_INVALID — it never reliably worked in SXA Headless's
 * rendering parameters dialog (the picker couldn't enumerate the
 * per-field folder), so authors must commit to one of the two
 * supported shapes.
 */
export function buildFieldOp(input: BuildFieldOpInput): Operation[] {
  const {
    recipeHandle,
    fieldRefKey,
    fieldPath,
    parentRefKey,
    labelPrefix,
    field,
    zeroBasedIndex,
    sortOrderBase = 0,
    policy,
    site,
    context,
  } = input;
  // Explicit `sitecore.sortOrder` values from the recipe are treated as
  // RELATIVE to the field group's base so existing recipes (which were
  // authored with `sortOrder: 100, 200, 300, ...`) continue to make
  // sense — for params, sortOrderBase=PARAMS_SORT_ORDER_BASE (1000)
  // lifts them above SXA's inherited low-hundreds fields. For
  // datasource fields, sortOrderBase=0 so explicit values are unchanged.
  // Auto-assigned values (no explicit sortOrder) get the same base +
  // 100-step increment.
  const explicitSortOrder = field.sitecore?.sortOrder;
  const sortOrder =
    explicitSortOrder != null
      ? sortOrderBase + explicitSortOrder
      : sortOrderBase + (zeroBasedIndex + 1) * 100;
  const sitecoreType = resolveSitecoreType(field);
  const fields: FieldValue[] = [
    sharedField(TEMPLATE_FIELD_FIELDS.TYPE, {
      kind: "string",
      value: sitecoreFieldTypeLabel(sitecoreType),
    }),
    sharedField(SYSTEM_FIELDS.SORT_ORDER, { kind: "number", value: sortOrder }),
    versionedField(TEMPLATE_FIELD_FIELDS.TITLE, { kind: "string", value: field.name }),
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: field.name }),
  ];

  const sourceValue = resolveFieldSource(field, sitecoreType, site, recipeHandle, context);
  if (sourceValue !== undefined) {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.SOURCE, sourceValue));
  }

  // Field storage axis. `versioned` is Sitecore's default for a new
  // Template Field (Shared + Unversioned both unset) — emit nothing.
  // IMAGE fields default to SHARED: brand imagery is language-invariant
  // (the registry's role-based image defaults must show in every locale,
  // and per-language image versions were empty everywhere but `en` —
  // Sitecore has no field-level fallback by default). A recipe that
  // genuinely wants per-locale imagery opts out with an explicit
  // `sitecore.storage: "versioned"`.
  const storage = field.sitecore?.storage ?? (field.shape === "image" ? "shared" : undefined);
  if (storage === "shared") {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.SHARED, { kind: "string", value: "1" }));
  } else if (storage === "unversioned") {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.UNVERSIONED, { kind: "string", value: "1" }));
  }

  return [
    {
      op: "CreateItem",
      policy,
      label: `${labelPrefix}/${field.name}`,
      id: fieldRefKey,
      path: fieldPath,
      parent: { kind: "ref-recipe", refKey: parentRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      name: field.name,
      fields,
    } satisfies CreateItemOp,
  ];
}

function resolveSitecoreType(field: FieldDefinition | DesignParameter): SitecoreFieldType {
  if (field.sitecore?.type) {
    return field.sitecore.type;
  }
  const multiple = "multiple" in field ? field.multiple : undefined;
  return defaultSitecoreFieldType(field.shape, multiple);
}

/**
 * Map a recipe-level rendering-parameter VALUE to the wire form the
 * parameter's Sitecore field type stores — the form XM Cloud Pages'
 * properties panel reads back (operator-verified against working tenant
 * pages, where enum params ride as `%7BGUID%7D` and checkboxes as `1`):
 *
 *  - **checkbox** — `"true"`/`"1"` → `"1"`, anything else → `""`.
 *    A checkbox field holding the literal `true` displays as unchecked.
 *  - **enum-backed Droplink** (`shape: "enum"` + `sitecore.enumHandle`,
 *    not overridden to droplist) — the value NAME becomes the enum
 *    value item's curly-braced refKey GUID (`enumValueId` under
 *    `enumerationFolderId`), which plan-time captured-id substitution
 *    resolves to the real tenant item. A Droplink holding a raw name
 *    displays as unset and Edge's params resolution can't map it.
 *  - **droplist** (pipe-list Source) — stores the raw name; no mapping.
 *  - anything else — `undefined` (caller keeps the raw value).
 */
export function paramWireValue(
  param: DesignParameter,
  raw: string,
  site: string
): string | undefined {
  const type = resolveSitecoreType(param);
  if (type === "checkbox") {
    return raw === "true" || raw === "1" ? "1" : "";
  }
  if (param.shape === "enum" && type !== "droplist" && param.sitecore?.enumHandle) {
    return `{${enumValueId(enumerationFolderId(site, param.sitecore.enumHandle), raw).toUpperCase()}}`;
  }
  return undefined;
}

/**
 * Build the field-default entries for a template's `__Standard Values`
 * item. Each entry carries the field's recipe-derived `fieldId` AND
 * `fieldName` — Sitecore resolves recipe-created field GUIDs by name
 * against the SV item's template (the recipe-derived id won't match the
 * tenant's server-assigned field-definition id; the name lookup is what
 * actually writes the value).
 *
 * Reference-shape defaults (link / image / treelist, plus
 * non-enum-backed droplink) are skipped silently — those need encoded
 * GUIDs or structured payloads that the simple `default: "string"`
 * recipe surface can't express. Authors who need defaults for those
 * can layer them in via a `ContentItemRecipe` that targets the SV
 * path explicitly.
 *
 * Enum-shaped fields branch on the resolved Type:
 *   - **Type=Droplist** (override): default is the raw string. Droplist
 *     reads its options from a pipe-separated Source; SV default is a
 *     name match against that list.
 *   - **Type=Droplink + `sitecore.enumHandle`** (the canonical shared
 *     enum shape): default is a `ref-recipe` GUID reference to the
 *     value item under `enumerationFolderId(site, enumHandle)`.
 *   - **Type=Droplink without `sitecore.enumHandle`** (inline Droplink):
 *     unsupported — `resolveFieldSource` rejects it upstream and this
 *     function throws defensively if it ever reaches here.
 *
 * If the declared default isn't actually one of the enum's values, the
 * derived GUID won't exist on the tenant and the SV write fails at
 * apply time — author error, not silently masked here.
 */
/**
 * One non-primary-language `__Standard Values` field version — emitted
 * (via {@link emitStandardValuesLocaleVersions}) as an `AddItemVersion`
 * followed by a versioned `SetField` after the SV `CreateItem`.
 */
export interface StandardValuesLocaleVersion {
  fieldId: string;
  fieldName: string;
  language: string;
  value: RefValue;
}

/**
 * Result of {@link buildStandardValuesFieldEntries}: the primary-language
 * (`en`) field entries that go straight into the SV `CreateItem.fields`,
 * plus any non-primary language versions a locale-map default declared.
 */
export interface StandardValuesBuild {
  primary: FieldValue[];
  localeVersions: StandardValuesLocaleVersion[];
}

// Cohesive SV builder: positional args keep the 30+ call sites terse; an
// options object for the two trailing optionals would be the only thing over
// the limit. Same justification as serialization/api/items.ts.
// eslint-disable-next-line max-params
export function buildStandardValuesFieldEntries(
  site: string,
  handle: string,
  fields: ReadonlyArray<FieldDefinition | DesignParameter>,
  // Resolver for the field-definition refKey. Defaults to `fieldId`
  // (component/content templates); pass `designParameterFieldId` when emitting
  // SV defaults for a parameters template (which uses a different
  // GUID family scoped under `designParametersTemplateId`).
  fieldIdResolver: (site: string, handle: string, fieldName: string) => string = fieldId,
  // When provided, image defaults with external URLs are materialised
  // as media items: a MediaUpload op lands in the sink and the SV entry
  // stores a `media-xml-ref` instead of the legacy `<image src=…>` XML
  // (which Pages/Layout Service never render). The caller must push the
  // sink's mediaOps BEFORE the CreateItem carrying these entries.
  imageMediaSink?: ImageMediaSink,
  // Languages registered on the target environment (Sites API
  // `listLanguages`). When set, locale-map defaults resolve their
  // non-primary versions against it — a template installs SV versions
  // only in the brand's languages and never emits an AddItemVersion for a
  // language the tenant doesn't have (which the Authoring API rejects).
  // A bare base-language key (`de`) fans out to every registered regional
  // variant (`de-DE`, `de-AT`, …); an explicit regional key overrides the
  // base for its exact locale. The primary language is always emitted.
  // Unset ⇒ emit every authored locale verbatim (standalone compile).
  availableLanguages?: readonly string[]
): StandardValuesBuild {
  const primary: FieldValue[] = [];
  const localeVersions: StandardValuesLocaleVersion[] = [];

  for (const field of fields) {
    const rawDefault = field.sitecore?.defaultValue ?? field.default;

    // Locale-map default → one __Standard Values version per language.
    if (rawDefault !== undefined && typeof rawDefault === "object") {
      appendLocalizedStandardValue({
        field,
        localeMap: rawDefault,
        site,
        handle,
        fieldIdResolver,
        imageMediaSink,
        availableLanguages,
        primary,
        localeVersions,
      });
      continue;
    }

    // Plain-string (or absent) default → single primary-language entry.
    let raw = rawDefault;
    if (raw === undefined) {
      // A role-annotated image field with no authored default still
      // gets the brand's image-default when the installer's map covers
      // its role — the role IS the dependency declaration; recipes
      // shouldn't need a throwaway stock URL for substitution to work.
      // The mapped URL feeds the normal encode path, where
      // `externalImageMediaRef` re-applies the same override and
      // materialises the shared site-level media item.
      const role = "role" in field ? field.role : undefined;
      const mapped =
        field.shape === "image" && role !== undefined
          ? imageMediaSink?.imageDefaults?.[role]
          : undefined;
      if (mapped === undefined) continue;
      raw = mapped;
    }
    const value = encodeStandardValueDefaultForField(raw, field, site, handle, imageMediaSink);
    if (value === undefined) continue;
    primary.push({
      fieldId: fieldIdResolver(site, handle, field.name),
      fieldName: field.name,
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value,
    });
  }
  return { primary, localeVersions };
}

/**
 * Expand a locale-map default (`{ en, de, … }`) into a primary-language
 * `__Standard Values` entry plus one non-primary language version per
 * additional (environment-registered) locale.
 *
 * Locale maps only make sense for language-varying copy, so this rejects
 * any non-text/rich-text shape — a GUID reference, image, boolean, or
 * numeric default can't meaningfully differ by language, and silently
 * accepting one would encode the same value N times. The map must carry
 * the primary language (`en`) as its base version.
 *
 * **Base-language expansion.** A map key may be a bare base language
 * (`de`, `zh`) or a full regional code (`de-DE`, `zh-TW`). Against a live
 * environment, keys resolve to the tenant's actual registered languages:
 * a base key fans out to every registered regional variant of that
 * language (`de` → `de-DE`, `de-AT`, …), each carrying the base value,
 * so authors write one translation per language rather than one per
 * region — matching how the dictionary's pre-expanded translations
 * behave, but done in the compiler. An explicit regional key overrides
 * the base expansion for that exact locale (`{ de: "…", "de-CH": "…" }`
 * gives every `de-*` the base copy except `de-CH`). Keys that match no
 * registered language are dropped. With no environment (standalone
 * compile) keys are emitted verbatim.
 */
function appendLocalizedStandardValue(args: {
  field: FieldDefinition | DesignParameter;
  localeMap: Record<string, string>;
  site: string;
  handle: string;
  fieldIdResolver: (site: string, handle: string, fieldName: string) => string;
  imageMediaSink?: ImageMediaSink;
  availableLanguages?: readonly string[];
  primary: FieldValue[];
  localeVersions: StandardValuesLocaleVersion[];
}): void {
  const {
    field,
    localeMap,
    site,
    handle,
    fieldIdResolver,
    imageMediaSink,
    availableLanguages,
    primary,
    localeVersions,
  } = args;

  if (field.shape !== "text" && field.shape !== "richText") {
    throw createScaiError(
      `Field '${field.name}' on recipe '${handle}' declares a per-locale default map but has shape='${field.shape}'. Locale-map defaults are only supported on text / rich-text fields — other shapes (enum, reference, image, boolean, number) can't vary a default by language.`,
      "INPUT_INVALID",
      {
        hint: "Use a plain string `default` for non-text fields, or change the field to shape `text` / `richText`.",
      }
    );
  }

  const primaryRaw = localeMap[DEFAULT_LANGUAGE];
  if (primaryRaw === undefined) {
    throw createScaiError(
      `Field '${field.name}' on recipe '${handle}' declares a per-locale default map without the primary language '${DEFAULT_LANGUAGE}'. The base __Standard Values version is always the primary language, so the map must include it.`,
      "INPUT_INVALID",
      {
        hint: `Add an '${DEFAULT_LANGUAGE}' entry to the default map, e.g. { ${DEFAULT_LANGUAGE}: "…", de: "…" }.`,
      }
    );
  }

  const refKey = fieldIdResolver(site, handle, field.name);

  const primaryValue = encodeStandardValueDefaultForField(
    primaryRaw,
    field,
    site,
    handle,
    imageMediaSink
  );
  if (primaryValue !== undefined) {
    primary.push({
      fieldId: refKey,
      fieldName: field.name,
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value: primaryValue,
    });
  }

  const encodeKey = (key: string): RefValue | undefined =>
    encodeStandardValueDefaultForField(localeMap[key], field, site, handle, imageMediaSink);

  const nonPrimaryKeys = Object.keys(localeMap).filter((k) => k !== DEFAULT_LANGUAGE);

  // Standalone compile (no live environment): emit each authored key
  // verbatim, sorted for deterministic op ordering.
  if (availableLanguages === undefined) {
    for (const key of nonPrimaryKeys.sort()) {
      const value = encodeKey(key);
      if (value === undefined) continue;
      localeVersions.push({ fieldId: refKey, fieldName: field.name, language: key, value });
    }
    return;
  }

  // Resolve authored keys to the environment's actual registered codes.
  // Explicit regional keys win over base-language expansion for their
  // exact locale; `resolved` maps registered-code → value keyed by the
  // registered code's own casing so we emit exactly what the tenant has.
  const resolved = new Map<string, RefValue>();
  const isRegional = (key: string) => /[-_]/.test(key);
  const baseOf = (code: string) => code.split(/[-_]/)[0].toLowerCase();

  // Pass 1 — exact matches (a key equal to a registered code, case-
  // insensitively). Authoritative, so a regional override sticks.
  for (const key of nonPrimaryKeys.sort()) {
    const matches = availableLanguages.filter((l) => l.toLowerCase() === key.toLowerCase());
    if (matches.length === 0) continue;
    const value = encodeKey(key);
    if (value === undefined) continue;
    for (const lang of matches) if (!resolved.has(lang)) resolved.set(lang, value);
  }

  // Pass 2 — base-language expansion: a bare base key fans out to every
  // registered regional variant not already pinned by an exact key.
  for (const key of nonPrimaryKeys.sort()) {
    if (isRegional(key)) continue;
    const matches = availableLanguages.filter((l) => baseOf(l) === key.toLowerCase());
    if (matches.length === 0) continue;
    const value = encodeKey(key);
    if (value === undefined) continue;
    for (const lang of matches) if (!resolved.has(lang)) resolved.set(lang, value);
  }

  const sortedTargets = [...resolved.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [lang, value] of sortedTargets) {
    localeVersions.push({ fieldId: refKey, fieldName: field.name, language: lang, value });
  }
}

/**
 * Emit the non-primary language versions a locale-map default produced.
 * Mirrors the dictionary translation pattern: a `SetField` against a
 * language with no version yet fails with "item … does not contain
 * version #1 in '<locale>'", so each new language gets one
 * `AddItemVersion` before its `SetField`(s). Call AFTER the SV
 * `CreateItem` (which materialises the primary-language version) and its
 * `SetStandardValues` link.
 */
export function emitStandardValuesLocaleVersions(
  operations: Operation[],
  standardValuesRefKey: string,
  localeVersions: readonly StandardValuesLocaleVersion[],
  policy: PushPolicy,
  labelPrefix: string
): void {
  // PHASED: every language's AddItemVersion first, then every SetField.
  // Version stacks for different languages are independent, so the
  // executor's write pool fans the grouped adds out `applyConcurrency`-
  // wide; the old add→set→add→set interleave gated each locale's add on
  // the previous locale's field write (one round-trip at a time — ×9
  // locales on every component's SV item).
  const versionAdds: AddItemVersionOp[] = [];
  const fieldWrites: SetFieldOp[] = [];
  const versioned = new Set<string>();
  for (const lv of localeVersions) {
    if (!versioned.has(lv.language)) {
      versioned.add(lv.language);
      versionAdds.push({
        op: "AddItemVersion",
        policy,
        label: `${labelPrefix}-version:${lv.language}`,
        itemRefKey: standardValuesRefKey,
        language: lv.language,
        version: DEFAULT_VERSION,
      } satisfies AddItemVersionOp);
    }
    fieldWrites.push({
      op: "SetField",
      policy,
      label: `${labelPrefix}-locale:${lv.fieldName}:${lv.language}`,
      itemRefKey: standardValuesRefKey,
      fieldId: lv.fieldId,
      fieldName: lv.fieldName,
      language: lv.language,
      version: DEFAULT_VERSION,
      value: lv.value,
    } satisfies SetFieldOp);
  }
  operations.push(...versionAdds, ...fieldWrites);
}

/**
 * Encode an SV default value for a field. Wraps `encodeStandardValueDefault`
 * with shape-aware handling for enum fields.
 *
 * Type decides the encoding shape:
 *   - Type=Droplink + `sitecore.enumHandle`: default is a GUID reference
 *     to the value item under the EnumerationRecipe's folder
 *     (`enumerationFolderId(site, enumHandle)`).
 *   - Type=Droplist (override): default is the raw string — Droplist's
 *     own enumeration is a pipe-separated Source string, so a name match
 *     in that list is the right encoding.
 *   - Type=Droplink without `enumHandle`: throws INPUT_INVALID — inline
 *     Droplink isn't supported; authors must commit to one of the two
 *     shapes above.
 */
function encodeStandardValueDefaultForField(
  raw: string,
  field: FieldDefinition | DesignParameter,
  site: string,
  handle: string,
  imageMediaSink?: ImageMediaSink
): RefValue | undefined {
  if (field.shape === "enum") {
    const sitecoreType = resolveSitecoreType(field);
    if (sitecoreType === "droplist") {
      // Droplist enumerates from a pipe-list Source; the SV default is
      // the raw value string, not a GUID.
      return { kind: "string", value: raw };
    }
    const enumHandle = field.sitecore?.enumHandle;
    if (!enumHandle) {
      // Defensive — `resolveFieldSource` rejects inline Droplink at the
      // upstream call site, so this branch only fires if an enum field
      // somehow reached SV emission without going through field-op
      // construction. Throw rather than emit a broken default.
      throw createScaiError(
        `Field '${field.name}' on recipe '${handle}' is shape=enum + Type=Droplink but declares no sitecore.enumHandle; inline Droplink isn't supported.`,
        "INPUT_INVALID",
        {
          hint: "Either set `sitecore.enumHandle` to a shared EnumerationRecipe's handle, or override `sitecore.type` to 'droplist' for an inline pipe-list dropdown.",
        }
      );
    }
    return {
      kind: "ref-recipe",
      refKey: enumValueId(enumerationFolderId(site, enumHandle), raw),
    };
  }
  // Reference-shape fields (`shape: "reference"`): the default is one
  // or more recipe handles pointing at content items. Resolve each
  // handle to its deterministic `contentItemId(site, handle)` GUID and
  // emit a `ref-recipe` (single) or `ref-recipe-list` (multi). The
  // executor matches each refKey against the per-run captured-itemId
  // map at apply time. If the referenced handle doesn't materialise as
  // a content item in the same recipe set, the SV write fails at apply
  // time — author error, not silently masked here (same contract as
  // enum defaults above).
  //
  // Convention:
  //   `multiple: false` (Droplink) — single handle string, e.g.
  //     `default: "author-jane@1"`
  //   `multiple: true`  (Treelist / Treelist-with-search) — pipe-
  //     separated handles, e.g. `default: "author-jane@1|author-bob@1"`
  if (field.shape === "reference") {
    // `multiple` lives on FieldDefinition (Treelist) but not on
    // DesignParameter — parameters templates don't model multi-list
    // pickers in scai today. Safe in-check covers both shapes.
    const isMulti = "multiple" in field && field.multiple === true;
    // enumHandle on a reference field = pick from a shared enum's
    // value items. Each pipe-separated token maps to an enum value
    // *name*; resolve to `enumValueId` instead of `contentItemId` so
    // the SV write points at the right value items under the enum
    // folder. Same contract as enum-shape SV defaults — author error
    // (referencing a value that doesn't exist on the enum) fails at
    // apply time with the standard captured-itemId error.
    if (field.sitecore?.enumHandle) {
      const enumFolder = enumerationFolderId(site, field.sitecore.enumHandle);
      const tokens = raw
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (tokens.length === 0) return undefined;
      if (isMulti) {
        return {
          kind: "ref-recipe-list",
          refKeys: tokens.map((t) => enumValueId(enumFolder, t)),
        };
      }
      return { kind: "ref-recipe", refKey: enumValueId(enumFolder, tokens[0]) };
    }
    if (isMulti) {
      const handles = raw
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (handles.length === 0) return undefined;
      return {
        kind: "ref-recipe-list",
        refKeys: handles.map((h) => contentItemId(site, h)),
      };
    }
    const target = raw.trim();
    if (target === "") return undefined;
    return { kind: "ref-recipe", refKey: contentItemId(site, target) };
  }
  return encodeStandardValueDefault(
    raw,
    resolveSitecoreType(field),
    imageMediaSink
      ? {
          site,
          handle,
          fieldName: field.name,
          sink: imageMediaSink,
          // `role` lives on FieldDefinition only (DesignParameter fields
          // don't model images); the in-check covers both union members.
          ...("role" in field && field.role !== undefined ? { role: field.role } : {}),
        }
      : undefined
  );
}

const BOOLEAN_TRUE_PATTERN = /^(1|true|yes|on|enabled)$/i;

function encodeStandardValueDefault(
  raw: string,
  type: SitecoreFieldType,
  imageCtx?: {
    site: string;
    handle: string;
    fieldName: string;
    sink: ImageMediaSink;
    role?: string;
  }
): RefValue | undefined {
  switch (type) {
    case "checkbox":
      // Sitecore stores checkboxes as "1" (true) / "" (false).
      return { kind: "string", value: BOOLEAN_TRUE_PATTERN.test(raw.trim()) ? "1" : "" };
    case "single-line-text":
    case "multi-line-text":
    case "rich-text":
    case "droplist":
    case "lookup":
    case "tags":
    case "number":
    case "integer":
    case "date":
    case "datetime":
      return { kind: "string", value: raw };
    case "general-link": {
      // Convention: pipe-separated `"<text>|<url>"`. Either half may
      // be empty (`"Click|"` → text only, `"|https://x"` → url only).
      // No pipe (`"Just text"`) is treated as text + anchor `#`. The
      // encoded payload is the Sitecore link-field XML format that
      // Standard Values stores natively. This gives recipe authors a
      // way to seed `general-link` SVs so dropped renderings visualise
      // immediately instead of rendering empty button shells.
      const encoded = encodeGeneralLinkDefault(raw);
      if (encoded == null) return undefined;
      return { kind: "string", value: encoded };
    }
    case "image": {
      // Convention: pipe-separated `"<alt>|<src>"`. `<src>` alone (no
      // pipe) seeds a srcless-but-altless default.
      //
      // External-URL defaults (the common case — recipe authors seed
      // picsum/dicebear URLs) are materialised as REAL media items:
      // a MediaUpload op + `media-xml-ref` SV value resolving to
      // `<image mediaid="{GUID}" />`. Bare `src=` XML is stored only
      // when no sink is available (legacy callers) — that form shows a
      // thumbnail in Pages' field editor but never renders on the
      // canvas or in head apps, because the Layout Service only builds
      // a renderable `src` from `mediaid`.
      const parsed = parseAltSrcDefault(raw);
      if (!parsed) return undefined;
      if (imageCtx && isExternalMediaUrl(parsed.src)) {
        return externalImageMediaRef({
          site: imageCtx.site,
          recipeHandle: imageCtx.handle,
          fieldName: imageCtx.fieldName,
          url: parsed.src,
          ...(parsed.alt ? { alt: parsed.alt } : {}),
          ...(imageCtx.role !== undefined ? { role: imageCtx.role } : {}),
          // Standard Values ARE the stock defaults — the one place the
          // brand image-defaults map is meant to substitute.
          substituteRole: true,
          sink: imageCtx.sink,
        });
      }
      const encoded = encodeImageDefault(raw);
      if (encoded == null) return undefined;
      return { kind: "string", value: encoded };
    }
    case "file": {
      // Same `<alt>|<src>` convention as image, but emits the
      // file-field XML (`<file src="…" />`). Layout Service surfaces
      // it as `{ src, ... }` in the file-field value. As with image,
      // no `mediaid` form — recipes don't ship media items, so the
      // external-URL `src` form is what we can express. Authors swap
      // to a real media library item via the file picker.
      const encoded = encodeFileDefault(raw);
      if (encoded == null) return undefined;
      return { kind: "string", value: encoded };
    }
    case "droplink":
    case "treelist":
    case "treelist-with-search":
      // Reference-shape defaults are encoded upstream in
      // `encodeStandardValueDefaultForField` via the recipe-handle
      // resolver (single → `ref-recipe`, multi → `ref-recipe-list`).
      // Reaching this branch means the field declared `shape:
      // "reference"` but the upstream branch didn't fire — defensive
      // skip so a malformed recipe doesn't emit a broken default.
      return undefined;
  }
}

// Sitecore link field stores a small XML payload in the Standard Values
// row. Attributes are XML-escaped. `linktype` mirrors what the platform
// picks based on URL shape — only mailto/anchor warrant special types
// here; relative paths and absolute URLs both use the `external` type
// (Sitecore's runtime renders them the same; the link picker decides
// internal vs external at author-time for items it can resolve).
function encodeGeneralLinkDefault(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const pipeIndex = trimmed.indexOf("|");
  const text = pipeIndex === -1 ? trimmed : trimmed.slice(0, pipeIndex).trim();
  const url = pipeIndex === -1 ? "#" : trimmed.slice(pipeIndex + 1).trim() || "#";
  const linktype = url.startsWith("mailto:")
    ? "mailto"
    : url.startsWith("#")
      ? "anchor"
      : "external";
  const attrs: Array<[string, string]> = [
    ["text", text],
    ["linktype", linktype],
    ["url", url],
  ];
  return `<link ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(" ")} />`;
}

// Sitecore image field stores XML in the Standard Values row. The
// canonical attribute is `mediaid` (a GUID reference into the media
// library) — the ONLY form the Layout Service surfaces as a renderable
// `src`. External-URL defaults are therefore materialised as media
// items via `externalImageMediaRef` (MediaUpload + media-xml-ref); this
// legacy `src=` XML form remains only as the no-sink fallback. Bare
// `src=`/`mediapath=` attributes show a thumbnail in Pages' field
// editor (which reads the raw value) but never render on the canvas or
// the head app. Empty raw returns undefined so the SV entry is skipped.
function encodeImageDefault(raw: string): string | undefined {
  return encodeMediaXmlDefault("image", raw);
}

/**
 * True when an image path/URL is a fully-qualified external URL rather
 * than a media-library path.
 */
export const isExternalMediaUrl = (path: string): boolean => /^https?:\/\//i.test(path);

/**
 * Accumulator for the `MediaUpload` ops a compile emits alongside field
 * values. Callers own ordering: push `mediaOps` into the operation list
 * BEFORE the CreateItem/SetField ops whose `media-xml-ref` values
 * reference them, so the executor captures each media itemId first.
 */
export interface ImageMediaSink {
  policy: PushPolicy;
  mediaOps: MediaUploadOp[];
  /**
   * Media-library folder the uploads land under — from
   * `CompileContext.mediaLibraryRoot`. Unset → the flat
   * `/sitecore/media library/RecipeImages/<site>` fallback.
   */
  mediaLibraryRoot?: string;
  /**
   * Pre-resolved folder from the recipe's `mediaLocation` declaration
   * (see `resolveMediaLocationFolder`). When set it wins over
   * `mediaLibraryRoot` and skips the `<recipeName>/` nesting — the
   * author owns the layout. A per-image `mediaLibraryFolder` still
   * overrides this.
   */
  locationFolder?: string;
  /**
   * Brand image-defaults map (role → external URL) from
   * `CompileContext.imageDefaults` (`--image-defaults <file.json>`).
   * An image value that carries a `role` present in this map
   * materialises the mapped URL instead of its recipe-authored one —
   * the substitution seam that keeps recipes brand-agnostic while an
   * installer supplies brand-appropriate imagery.
   */
  imageDefaults?: Readonly<Record<string, string>>;
}

/**
 * Resolve a recipe's `mediaLocation` declaration to the absolute
 * media-library folder its uploads land under — the media twin of the
 * datasource-locations model. Returns `undefined` when no location is
 * declared (callers fall back to the default `<root>/<recipeName>/`
 * nesting).
 *
 *   - `site`  → `<mediaLibraryRoot>/<subfolder?>`
 *   - `page`  → `<mediaLibraryRoot>/<pageRelativePath>/<subfolder?>` —
 *     only valid where a host page exists; callers that have no page
 *     (content items, template SV defaults) omit `pageRelativePath`
 *     and the compiler rejects the scope with INPUT_INVALID.
 */
export const resolveMediaLocationFolder = (
  location: { scope: "page" | "site"; subfolder?: string } | undefined,
  opts: {
    context: CompileContext;
    site: string;
    recipeHandle: string;
    /** The page item's path relative to `pagesRoot` — page recipes only. */
    pageRelativePath?: string;
  }
): string | undefined => {
  if (!location) return undefined;
  const base = trimEndChar(
    opts.context.mediaLibraryRoot ?? `/sitecore/media library/RecipeImages/${opts.site}`,
    "/"
  );
  if (location.scope === "site") {
    return location.subfolder ? `${base}/${location.subfolder}` : base;
  }
  if (!opts.pageRelativePath) {
    throw createScaiError(
      `Recipe '${opts.recipeHandle}': mediaLocation scope "page" is only valid on a PageRecipe — ` +
        `content items and templates have no host page to mirror.`,
      "INPUT_INVALID",
      { hint: 'Use `mediaLocation: { scope: "site", subfolder: "…" }` here instead.' }
    );
  }
  const pageFolder = `${base}/${opts.pageRelativePath}`;
  return location.subfolder ? `${pageFolder}/${location.subfolder}` : pageFolder;
};

/**
 * Materialise an external image URL as a media-library item: emit (or
 * dedupe onto) a `MediaUpload` op in the sink and return the
 * `media-xml-ref` value the consuming field stores. At apply time the
 * executor uploads the bytes, captures the server-assigned media
 * itemId, and resolves the ref to `<image mediaid="{GUID}" />` — the
 * form Pages' canvas, the Layout Service, and Edge all render.
 *
 * The refKey is deterministic per (site, recipe, field, URL), so the
 * same avatar repeated across languages/versions uploads once, while a
 * story that swaps the image per version gets one media item per URL.
 * The destination basename embeds a refKey fragment so two different
 * URLs on the same field can't collide on one media path (the
 * executor's idempotency lookup would otherwise capture the first
 * upload's item for both).
 *
 * Destination folder resolution, most-specific first:
 *   1. `folder` (the image value's own `mediaLibraryFolder`) — used
 *      as-is; only the generated leaf is appended.
 *   2. `sink.locationFolder` (the recipe's `mediaLocation` declaration,
 *      page- or site-scoped) — used as-is, no `<recipeName>/` nesting.
 *   3. `sink.mediaLibraryRoot` (from `CompileContext.mediaLibraryRoot`,
 *      i.e. env-profile `recipeRoots.mediaLibrary` / `--media-library-root`)
 *      — uploads nest under `<root>/<recipeName>/`.
 *   4. Fallback: `/sitecore/media library/RecipeImages/<site>/<recipeName>/`.
 *
 * **Role-substituted images are SITE-LEVEL, not per-recipe.** When an
 * image-defaults override fires, the media item is a brand default the
 * whole site shares — so its refKey is scoped to (site, role, URL)
 * instead of (site, recipe, field, URL), and it lands under
 * `<root>/Defaults/<role>-<hash>`. Every component/recipe that maps the
 * same role resolves the SAME refKey: within one push the first
 * MediaUpload captures the itemId and later duplicates skip; across
 * pushes the executor's path-based idempotency lookup reuses the
 * existing item. One brand image per role per site, uploaded once.
 */
export const externalImageMediaRef = (opts: {
  site: string;
  recipeHandle: string;
  fieldName: string;
  url: string;
  alt?: string;
  /**
   * Semantic image role — when set AND `substituteRole` is true AND
   * `sink.imageDefaults` maps it, the mapped URL replaces `url` before
   * materialisation (brand substitution). The refKey derives from the
   * EFFECTIVE URL, so two brands' maps yield distinct media items on
   * the same field.
   */
  role?: string;
  /**
   * Opt-in for image-defaults substitution. Set ONLY by the template
   * Standard-Values path — SV defaults are the component's stock
   * imagery, which is exactly what the brand map exists to replace.
   * AUTHORED content values (page/content-item images, exported story
   * imagery) must never be overridden by a role default: the author's
   * value always wins over the standard value.
   */
  substituteRole?: boolean;
  /** Per-value destination folder override (`image.mediaLibraryFolder`). */
  folder?: string;
  sink: ImageMediaSink;
}): RefValue => {
  const { site, recipeHandle, fieldName, alt, folder, sink } = opts;
  const override =
    opts.substituteRole === true && opts.role !== undefined
      ? sink.imageDefaults?.[opts.role]
      : undefined;
  if (override !== undefined && !isExternalMediaUrl(override)) {
    throw createScaiError(
      `Image-defaults entry for role '${opts.role}' is not an http(s) URL: '${override}'.`,
      "INPUT_INVALID",
      { hint: "Image-defaults map values must be fully-qualified external URLs." }
    );
  }
  const url = override ?? opts.url;
  // Brand-substituted images are shared site assets: identity is
  // (site, role, URL) so every consumer of the role converges on one
  // media item in the site's Defaults folder. Recipe-authored images
  // keep the per-(recipe, field) identity and folders documented above.
  const isSiteDefault = override !== undefined && opts.role !== undefined;
  const refKey = isSiteDefault
    ? mediaFieldId(site, "site-image-defaults", opts.role as string, url)
    : mediaFieldId(site, recipeHandle, fieldName, url);
  if (!sink.mediaOps.some((op) => op.id === refKey)) {
    const mediaRoot = trimEndChar(
      sink.mediaLibraryRoot ?? `/sitecore/media library/RecipeImages/${site}`,
      "/"
    );
    const recipeName = recipeHandle.split("@")[0];
    const destinationFolder = isSiteDefault
      ? `${mediaRoot}/Defaults`
      : folder
        ? trimEndChar(folder, "/")
        : sink.locationFolder !== undefined
          ? trimEndChar(sink.locationFolder, "/")
          : `${mediaRoot}/${recipeName}`;
    const leaf = isSiteDefault
      ? `${opts.role}-${refKey.slice(0, 8)}`
      : `${fieldName}-${refKey.slice(0, 8)}`;
    sink.mediaOps.push({
      op: "MediaUpload",
      policy: sink.policy,
      label: isSiteDefault
        ? `media-upload:site-image-defaults:${opts.role}`
        : `media-upload:${recipeHandle}:${fieldName}`,
      id: refKey,
      source: { kind: "external-url", url },
      destinationPath: `${destinationFolder}/${leaf}`,
      ...(alt ? { altText: alt } : {}),
    });
  }
  return { kind: "media-xml-ref", refKey };
};

// Same convention as image (`<alt>|<src>` or bare `<src>`); emits the
// file-field XML form. Authors swap to a media-library item via the
// file picker at placement time; seed src renders in the meantime.
function encodeFileDefault(raw: string): string | undefined {
  return encodeMediaXmlDefault("file", raw);
}

// Parse the pipe-separated `"<alt>|<src>"` media-default convention.
// `<src>` alone (no pipe) yields an empty alt. Empty/whitespace src
// collapses to undefined so callers skip the SV entry entirely.
function parseAltSrcDefault(raw: string): { alt: string; src: string } | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const pipeIndex = trimmed.indexOf("|");
  const alt = pipeIndex === -1 ? "" : trimmed.slice(0, pipeIndex).trim();
  const src = pipeIndex === -1 ? trimmed : trimmed.slice(pipeIndex + 1).trim();
  if (!src) return undefined;
  return { alt, src };
}

// Shared XML body for image + file fields. Sitecore's stored shape
// for both is identical: `<image src="..." alt="..." />` vs
// `<file src="..." alt="..." />`. The element name is the only
// difference.
function encodeMediaXmlDefault(element: "image" | "file", raw: string): string | undefined {
  const parsed = parseAltSrcDefault(raw);
  if (!parsed) return undefined;
  const attrs: Array<[string, string]> = [["src", parsed.src]];
  if (parsed.alt) attrs.push(["alt", parsed.alt]);
  return `<${element} ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(" ")} />`;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Resolve a recipe field's `Source` value to a Sitecore-encoded string.
 *
 * When `sourceTypes` references recipe handles, the wire string depends
 * on the resolved Sitecore itemIds — we can't render at compile time, so
 * we emit `ref-source-fields` and the executor finishes the job with the
 * captured-itemId resolver.
 *
 * Sources without handle references (`sourceRaw`, or `sourceQuery` /
 * `sourceScope` alone) render at compile time as a plain string.
 *
 * Enum fields (`shape: "enum"`) accept exactly two shapes — the
 * compiler rejects anything else with INPUT_INVALID:
 *   - **Type=Droplink + `sitecore.enumHandle`** (the canonical shared
 *     shape): Source is the EnumerationRecipe's tenant content path
 *     (resolved via `context.enumsByHandle`). SXA enumerates that
 *     path's children as picker entries; the values live as content
 *     items the EnumerationRecipe owns. Source is emitted as a path
 *     string (not a `{GUID}`) — SXA Headless's rendering parameter
 *     dialog only enumerates Droplink Source as a content path / query.
 *   - **Type=Droplist (override) + inline `values: [...]`**: Source is
 *     a pipe-separated literal of the values — Sitecore reads the
 *     option list straight out of the Source string with no folder
 *     lookup. No content items are emitted.
 *
 * Inline Droplink (shape=enum + `values` + neither override) is rejected
 * here: SXA Headless's rendering parameters dialog never reliably picked
 * up the per-field folder of values, so authors must commit to one of
 * the two supported shapes.
 *
 * Shared-enum + Droplist isn't supported either — Droplist needs values
 * at compile time, which we can't resolve from a sibling EnumerationRecipe
 * without a lookup.
 */
function resolveFieldSource(
  field: FieldDefinition | DesignParameter,
  type: SitecoreFieldType,
  site: string,
  recipeHandle: string,
  context?: CompileContext
): RefValue | undefined {
  const sc = field.sitecore;
  if (sc) {
    const effectiveSource = applyMarketplacePluginOverride(
      sc.source,
      context?.marketplacePluginOverrides
    );
    const fields = augmentSourceToFields(effectiveSource);
    if (sourceFieldsNeedHandleResolution(fields)) {
      // `types` is non-empty here because `sourceFieldsNeedHandleResolution`
      // returned true; the cast is to satisfy the IR's `.min(1)` constraint.
      return {
        kind: "ref-source-fields",
        site,
        sourceTypes: fields.sourceTypes as string[],
        sourceQuery: fields.sourceQuery,
        sourceScope: fields.sourceScope,
      };
    }
    const rendered = renderSourceFields(fields, () => {
      throw createScaiError("compile-time render should not need handle resolution", "UNKNOWN");
    });
    if (rendered !== undefined) {
      return { kind: "string", value: rendered };
    }
  }
  // Reference-shape + enumHandle = multi-pick Treelist sourced from a
  // shared enum. Earlier iterations emitted the combined form
  // `DataSource=<path>&IncludeTemplatesForSelection=<GUID>` so the
  // picker would scope to the enum's folder AND restrict pickable
  // items to the enum value template — but Sitecore Pages's Treelist
  // chrome rejected every enum-value pick under that filter, leaving
  // authors with "the source's filter doesn't allow those options"
  // and no way to select platforms. The filter isn't load-bearing in
  // practice: scai deliberately doesn't emit per-folder
  // `__Standard Values` items inside enum folders (see the comment
  // in `compileEnumerationRecipe`), so the enum folder's children
  // are exactly the value items the picker should surface. Dropping
  // the template filter keeps the picker working in Pages and only
  // matters for tenants where an author manually drops stray content
  // under an enum folder (rare and recoverable). Single-pick
  // reference (Droplink) follows the same plain-`DataSource=` shape.
  if (field.shape === "reference" && sc?.enumHandle) {
    if (!context) {
      throw createScaiError(
        `Field '${field.name}' on recipe '${recipeHandle}' uses sitecore.enumHandle='${sc.enumHandle}' on a reference field but the field-op builder was invoked without a CompileContext.`,
        "INPUT_INVALID",
        {
          hint: "Pass `context` into `buildFieldOp` so the enum's tenant path can be resolved from `enumsByHandle` + `enumerationsRoot`.",
        }
      );
    }
    const enumPath = resolveEnumFolderPath(context, sc.enumHandle, recipeHandle);
    return {
      kind: "string",
      value: `DataSource=${enumPath}`,
    };
  }
  if (field.shape === "enum") {
    // Droplist override on an enum field needs the inline values
    // baked into Source as a pipe-separated literal — SXA's Droplist
    // enumerates the string directly and never reads a folder.
    if (type === "droplist") {
      if (!field.values || field.values.length === 0) {
        throw createScaiError(
          `Field '${field.name}' on recipe '${recipeHandle}' overrides sitecore.type to 'droplist' but declares no inline values; Droplist needs an inline value list.`,
          "INPUT_INVALID",
          {
            hint: 'Either drop the `sitecore.type: "droplist"` override and add `sitecore.enumHandle: "<recipe>@<v>"` (shared Droplink), or add `values: [...]` to the field.',
          }
        );
      }
      return { kind: "string", value: field.values.join("|") };
    }
    if (sc?.enumHandle) {
      // Shared enum + Droplink — Source is the enum folder's tenant
      // content path (NOT a `{GUID}` reference). SXA Headless's
      // rendering parameter dialog enumerates Droplink Source as a path
      // / query; a bare GUID doesn't reliably surface picker options.
      // Path is computable at compile time from the EnumerationRecipe
      // looked up via `context.enumsByHandle`.
      if (!context) {
        throw createScaiError(
          `Field '${field.name}' on recipe '${recipeHandle}' uses sitecore.enumHandle='${sc.enumHandle}' but the field-op builder was invoked without a CompileContext.`,
          "INPUT_INVALID",
          {
            hint: "Pass `context` into `buildFieldOp` so the enum's tenant path can be resolved from `enumsByHandle` + `enumerationsRoot`.",
          }
        );
      }
      const enumPath = resolveEnumFolderPath(context, sc.enumHandle, recipeHandle);
      return { kind: "string", value: enumPath };
    }
    // Inline Droplink (shape=enum + values + no enumHandle + no Droplist
    // override) is not a valid shape — SXA Headless's rendering parameter
    // dialog never reliably picked up a per-field folder of values, so the
    // dropdown stayed empty in Pages. Force the author to commit:
    //   - Inline scale → `sitecore.type: "droplist"` + inline `values`.
    //   - Shared scale → `sitecore.enumHandle: "<EnumerationRecipe>@<v>"`.
    throw createScaiError(
      `Field '${field.name}' on recipe '${recipeHandle}' is shape=enum but declares neither sitecore.type='droplist' (with inline values) nor sitecore.enumHandle (pointing at a shared EnumerationRecipe); inline Droplink isn't supported.`,
      "INPUT_INVALID",
      {
        hint: 'Pick one: add `sitecore.type: "droplist"` for an inline pipe-list dropdown, or `sitecore.enumHandle: "<recipe>@<v>"` to point at a shared EnumerationRecipe (which authors edit out-of-band as content items).',
      }
    );
  }
  if (type === "droplist" && field.values && field.values.length > 0) {
    return { kind: "string", value: field.values.join("|") };
  }
  return undefined;
}

interface FieldGroup {
  section: string;
  fields: FieldDefinition[];
}

/**
 * Group recipe fields by their `sitecore.section` (default "Content").
 * Section emit order = order of first occurrence in the recipe — the
 * compiler is purely stable; recipe authors control ordering.
 */
function groupFieldsBySection(fields: FieldDefinition[]): FieldGroup[] {
  const order: string[] = [];
  const bySection = new Map<string, FieldDefinition[]>();
  for (const field of fields) {
    const section = field.sitecore?.section ?? DEFAULT_FIELDS_SECTION;
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)!.push(field);
  }
  return order.map((section) => ({ section, fields: bySection.get(section)! }));
}
