import {
  componentFoldersBucketId,
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
  standardValuesId,
  templateId,
} from "../items/guids";
import {
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type PushPolicy,
  type RefValue,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "../ir/operations";
import { createScaiError } from "../../shared/errors";
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
   * Phase 4: required for `PartialDesignRecipe` compilation. Where the
   * partial-design items land — typically
   * `/sitecore/content/<site>/Presentation/Partial Designs`.
   * Optional in the type so Phase 1 callers don't have to set it; the
   * partial-design compiler errors with a clear message if absent.
   */
  partialDesignsRoot?: string;
  /**
   * Phase 4: required for `PageDesignRecipe` compilation. Where the
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
   * Phase 4: required for `ContentItemRecipe` compilation. Where shared
   * content items land — typically `/sitecore/content/<tenant>/<site>/Data`
   * or a sub-bucket for SXA sites. ContentItemRecipes encode `kind: "shared"`
   * datasource targets referenced from partial / page design layouts.
   */
  contentItemsRoot?: string;
  /**
   * Phase 5: required for `SiteTemplateRecipe` compilation. Where SXA
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
  sectionsByHandle?: ReadonlyMap<string, import("../schema/recipe").ComponentSectionRecipe>;
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
  enumsByHandle?: ReadonlyMap<string, import("../schema/recipe").EnumerationRecipe>;
  /**
   * Cross-recipe map of component handles → `ComponentTemplateRecipe`,
   * populated by `compileRecipeSet`. `compilePageRecipe` uses it to
   * resolve a scoped placement's component to its datasource template:
   * `datasource.template.handle` when the component declares a separate
   * content template, else the component template itself. Absent for
   * standalone single-recipe compiles — the page compiler then assumes
   * the component template is its own datasource template.
   */
  componentsByHandle?: ReadonlyMap<string, import("../schema/recipe").ComponentTemplateRecipe>;
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
}

export const PARAMS_SECTION_NAME = "Parameters";
export const DEFAULT_FIELDS_SECTION = "Content";

export const COMPONENT_FOLDERS_BUCKET = "Component Folders";
export const PRESENTATION_PARAMETERS_BUCKET = "Presentation Parameters";

export const joinPath = (parent: string, name: string): string => {
  const trimmed = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${trimmed}/${name}`;
};

/** Site name for deterministic folder refKeys. */
export const siteOf = (context: CompileContext): string => context.site ?? "default";

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
  const sentinel = `enumeration-templates:${site}`;
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
    baseTemplates: [STANDARD_TEMPLATE_ID, ...(recipe.additionalBaseTemplates ?? [])],
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
    // initial content instead of an empty form. Reference-shape fields
    // (link/image/etc.) are skipped — their defaults need encoded
    // payloads outside the simple string-default surface.
    fields: buildStandardValuesFieldEntries(site, recipe.handle, recipe.fields),
  } satisfies CreateItemOp);

  operations.push({
    op: "SetStandardValues",
    policy,
    label: `link-standard-values:${recipe.handle}`,
    templateRefKey: tplRefKey,
    standardValuesRefKey: svRefKey,
  } satisfies SetStandardValuesOp);

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
    policy,
    site,
    context,
  } = input;
  const sortOrder = field.sitecore?.sortOrder ?? (zeroBasedIndex + 1) * 100;
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
  const storage = field.sitecore?.storage;
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
export function buildStandardValuesFieldEntries(
  site: string,
  handle: string,
  fields: ReadonlyArray<FieldDefinition | DesignParameter>,
  // Resolver for the field-definition refKey. Defaults to `fieldId`
  // (component/content templates); pass `designParameterFieldId` when emitting
  // SV defaults for a parameters template (which uses a different
  // GUID family scoped under `designParametersTemplateId`).
  fieldIdResolver: (site: string, handle: string, fieldName: string) => string = fieldId
): FieldValue[] {
  const entries: FieldValue[] = [];
  for (const field of fields) {
    const raw = field.sitecore?.defaultValue ?? field.default;
    if (raw === undefined) continue;
    const value = encodeStandardValueDefaultForField(raw, field, site, handle);
    if (value === undefined) continue;
    entries.push({
      fieldId: fieldIdResolver(site, handle, field.name),
      fieldName: field.name,
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value,
    });
  }
  return entries;
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
  handle: string
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
  return encodeStandardValueDefault(raw, resolveSitecoreType(field));
}

const BOOLEAN_TRUE_PATTERN = /^(1|true|yes|on|enabled)$/i;

function encodeStandardValueDefault(raw: string, type: SitecoreFieldType): RefValue | undefined {
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
    case "image":
    case "file":
    case "general-link":
    case "droplink":
    case "treelist":
    case "treelist-with-search":
      // Reference-shape defaults need encoded payloads; not expressible
      // via the simple `default: string` recipe surface. Skip; the field
      // still gets created without a default.
      return undefined;
  }
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
    const fields = augmentSourceToFields(sc.source);
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
