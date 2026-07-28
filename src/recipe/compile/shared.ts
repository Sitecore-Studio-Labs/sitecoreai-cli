import { type FieldValue } from "../ir/operations";
import { createScaiError } from "@/shared/errors";
import { DEFAULT_LANGUAGE, DEFAULT_VERSION } from "../ir/sitecore-templates";
import { type FieldDefinition, type DesignParameter } from "../schema/recipe";
import { defaultSitecoreFieldType, type SitecoreFieldType } from "../schema/field-types";

/**
 * Where a recipe's items land in the Sitecore content tree. Tenant-side
 * config — recipes themselves are tenant-agnostic. The compiler emits
 * deterministic Sitecore paths (`<templatesRoot>/<recipe.name>`, etc.)
 * that the executor resolves to server-assigned itemIds at runtime.
 */
export interface CompileContext {
  /**
   * Optional diagnostics sink. The compiler is otherwise pure, but a few
   * resilience paths DROP an op that would abort apply against invalid
   * generated content (e.g. a scoped datasource on a datasource-less
   * rendering) — surfacing the drop keeps it visible instead of silent.
   * Wired to the task logger's `warn` by `runRecipePush` / `runRecipeCompile`.
   */
  onWarn?: (message: string) => void;
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

export function resolveSitecoreType(field: FieldDefinition | DesignParameter): SitecoreFieldType {
  if (field.sitecore?.type) {
    return field.sitecore.type;
  }
  const multiple = "multiple" in field ? field.multiple : undefined;
  return defaultSitecoreFieldType(field.shape, multiple);
}
