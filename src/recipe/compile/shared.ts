import {
  componentFoldersBucketId,
  contentModelsGroupFolderId,
  enumerationFolderId,
  enumValueId,
  fieldId,
  inlineEnumFolderId,
  presentationParametersBucketId,
  renderingsSectionFolderId,
  sectionFolderId,
  sectionId,
  standardValuesId,
  templateId,
} from "../guids";
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
import { createCliError } from "../../shared/errors";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  FOLDER_ICON,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../ir/sitecore-templates";
import { type FieldDefinition, type ParamDefinition } from "../schema/recipe";
import {
  defaultSitecoreFieldType,
  type SitecoreFieldType,
  sitecoreFieldTypeLabel,
} from "../schema/field-types";
import { renderSourceFields, sourceFieldsNeedHandleResolution } from "../schema/source-fields";

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
   * `ParametersTemplateRecipe` compilation when any field carries
   * `sitecore.enumHandle`. Compiler throws INPUT_INVALID with a clear
   * message when needed but missing.
   */
  enumerationsRoot?: string;
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
}

export const PARAMS_SECTION_NAME = "Parameters";
export const DEFAULT_FIELDS_SECTION = "Content";

export const COMPONENT_FOLDERS_BUCKET = "Component Folders";
export const PRESENTATION_PARAMETERS_BUCKET = "Presentation Parameters";

/**
 * Icon for an `EnumerationRecipe`'s root folder item — distinct from
 * `FOLDER_ICON` so the SXA editor's content tree can quickly tell an
 * enum folder apart from a generic content / template folder.
 */
export const ENUMERATION_FOLDER_ICON = "office/16x16/list.png";

export const joinPath = (parent: string, name: string): string => {
  const trimmed = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${trimmed}/${name}`;
};

/** Site name for deterministic folder refKeys. */
export const siteOf = (context: CompileContext): string => context.site ?? "default";

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
export const resolvePresentationParametersBucketPath = (
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
export const ensurePresentationParametersBucket = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = presentationParametersBucketId(site, section);
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
          recipeName: recipe.name,
          recipeDisplayName: recipe.displayName,
          enumerationsRoot: context.enumerationsRoot,
          fieldRefKey: fieldId(site, recipe.handle, field.name),
          fieldPath: joinPath(secPath, field.name),
          parentRefKey: secRefKey,
          labelPrefix: `field:${recipe.handle}`,
          field,
          zeroBasedIndex: index,
          policy,
          site,
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
  /**
   * Recipe `name` (the Sitecore item name — e.g. `CtaButton`). Threaded
   * through so inline-enum folder items can use `<recipeName>--<fieldName>`
   * as both their content-tree name and `__Display name` prefix base.
   */
  recipeName: string;
  /**
   * Recipe `displayName` (when set). Used to build the inline-enum folder's
   * `__Display name` (`<recipeDisplayName> · <fieldName>`); falls back to
   * `recipeName` when unset, mirroring `compileEnumerationRecipe`.
   */
  recipeDisplayName: string | undefined;
  /**
   * Enumerations root from `CompileContext`. Required when any inline enum
   * field is being emitted — the per-field folder lands at
   * `<enumerationsRoot>/<recipeName>--<fieldName>/`. `buildFieldOp` throws
   * INPUT_INVALID when an inline enum field is encountered but this is
   * undefined.
   */
  enumerationsRoot: string | undefined;
  fieldRefKey: string;
  fieldPath: string;
  parentRefKey: string;
  labelPrefix: string;
  field: FieldDefinition | ParamDefinition;
  zeroBasedIndex: number;
  policy: PushPolicy;
  /**
   * Site name the recipe set is being compiled under. Threaded through to
   * `resolveFieldSource` so the emitted `ref-source-fields` value carries
   * the site — the executor's resolver needs it to derive `templateId(site,
   * handle)` for handle references in `sourceTypes`.
   */
  site: string;
}

/**
 * Build the CreateItem op(s) for a single field definition.
 *
 * Returns an array — usually length 1 (the field-definition item alone),
 * but for **inline enum** fields (`shape: "enum"` with no
 * `sitecore.enumHandle`) the returned array also includes:
 *   1. a Folder CreateItem for the per-field enum folder under
 *      `<enumerationsRoot>/<recipeName>--<fieldName>/`;
 *   2. one Folder CreateItem per declared value, parented under that
 *      folder.
 *
 * The field-definition item itself stays at its original path with no
 * value-item children; its `Source` resolves at apply-time to the per-
 * field folder via `ref-recipe` (see `resolveFieldSource`). This mirrors
 * the shared-enum layout — SXA Headless rendering parameter dialogs only
 * resolve `query:` Source against the *current* item (which the field-
 * definition isn't), so the dropdown stayed empty before. Pointing the
 * Source at the per-field folder fixes the picker.
 *
 * Shared-enum fields (with `enumHandle`) emit no value children here —
 * the values live under the `EnumerationRecipe`'s folder item, emitted
 * by `compileEnumerationRecipe`.
 */
export function buildFieldOp(input: BuildFieldOpInput): CreateItemOp[] {
  const {
    recipeHandle,
    recipeName,
    recipeDisplayName,
    enumerationsRoot,
    fieldRefKey,
    fieldPath,
    parentRefKey,
    labelPrefix,
    field,
    zeroBasedIndex,
    policy,
    site,
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

  const sourceValue = resolveFieldSource(field, sitecoreType, site, recipeHandle);
  if (sourceValue !== undefined) {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.SOURCE, sourceValue));
  }

  const fieldOp: CreateItemOp = {
    op: "CreateItem",
    policy,
    label: `${labelPrefix}/${field.name}`,
    id: fieldRefKey,
    path: fieldPath,
    parent: { kind: "ref-recipe", refKey: parentRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FIELD,
    name: field.name,
    fields,
  };

  const isInlineEnum =
    field.shape === "enum" &&
    !field.sitecore?.enumHandle &&
    field.values !== undefined &&
    field.values.length > 0;

  if (!isInlineEnum) {
    return [fieldOp];
  }

  if (!enumerationsRoot) {
    throw createCliError(
      `Inline enum field '${field.name}' on recipe '${recipeHandle}' requires enumerationsRoot but none is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `enumerationsRoot` on the active envProfile in sitecoreai.cli.json (e.g. `/sitecore/content/<siteCollection>/<site>/Settings/Enumerations`). Inline enum value items now live as children of a per-field Folder under the enumerations root so SXA's rendering parameter dialog can resolve them.",
      }
    );
  }

  const folderRefKey = inlineEnumFolderId(site, recipeHandle, field.name);
  const folderName = `${recipeName}--${field.name}`;
  const folderPath = joinPath(enumerationsRoot, folderName);
  const folderDisplayName = `${recipeDisplayName ?? recipeName} · ${field.name}`;

  const ops: CreateItemOp[] = [];

  // Per-field enum folder — same content-tree shape as a shared
  // EnumerationRecipe's folder, just keyed per-(recipe, field).
  ops.push({
    op: "CreateItem",
    policy,
    label: `inline-enum-folder:${recipeHandle}/${field.name}`,
    id: folderRefKey,
    path: folderPath,
    parent: { kind: "ref-path", value: enumerationsRoot },
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: folderName,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: ENUMERATION_FOLDER_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
        kind: "string",
        value: folderDisplayName,
      }),
    ],
  } satisfies CreateItemOp);

  // One value item per declared value, parented under the per-field folder.
  for (const value of field.values!) {
    ops.push({
      op: "CreateItem",
      policy,
      label: `inline-enum-value:${recipeHandle}/${field.name}/${value}`,
      id: enumValueId(folderRefKey, value),
      path: joinPath(folderPath, value),
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: SITECORE_TEMPLATES.FOLDER,
      name: value,
      fields: [versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value })],
    } satisfies CreateItemOp);
  }

  // Field definition lands LAST so the per-field folder + values are
  // already in the captured-itemId map by the time the field's
  // ref-recipe Source is resolved at apply time.
  ops.push(fieldOp);

  return ops;
}

function resolveSitecoreType(field: FieldDefinition | ParamDefinition): SitecoreFieldType {
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
 * Enum-shaped fields are special — their on-disk Sitecore type is
 * Droplink (since 2026-05), so the default value must encode as a
 * `ref-recipe` GUID reference to the value item, NOT a plain string.
 * The target value item's GUID derives from:
 *   - **Inline enum**: parent = the per-field enum folder
 *     (`inlineEnumFolderId(site, handle, field.name)`). Value items
 *     live under that folder under `<enumerationsRoot>` — see
 *     `buildFieldOp`'s inline-enum emission.
 *   - **Shared enum** (`sitecore.enumHandle`): parent =
 *     `enumerationFolderId(site, enumHandle)`.
 *
 * If the declared default isn't actually one of the enum's values, the
 * derived GUID won't exist on the tenant and the SV write fails at
 * apply time — author error, not silently masked here.
 */
export function buildStandardValuesFieldEntries(
  site: string,
  handle: string,
  fields: ReadonlyArray<FieldDefinition | ParamDefinition>,
  // Resolver for the field-definition refKey. Defaults to `fieldId`
  // (component/content templates); pass `paramsFieldId` when emitting
  // SV defaults for a parameters template (which uses a different
  // GUID family scoped under `paramsTemplateId`).
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
 * with shape-aware handling for enum fields (which now back Droplink and
 * thus need GUID references rather than raw strings).
 *
 * For enum fields the parent refKey for `enumValueId` derivation is the
 * folder that owns the value items — `enumerationFolderId(site,
 * enumHandle)` for shared enums, `inlineEnumFolderId(site, handle,
 * fieldName)` for inline enums. Both reflect the live content-tree
 * parentage of the value items.
 */
function encodeStandardValueDefaultForField(
  raw: string,
  field: FieldDefinition | ParamDefinition,
  site: string,
  handle: string
): RefValue | undefined {
  if (field.shape === "enum") {
    const enumHandle = field.sitecore?.enumHandle;
    const parentRefKey = enumHandle
      ? enumerationFolderId(site, enumHandle)
      : inlineEnumFolderId(site, handle, field.name);
    return { kind: "ref-recipe", refKey: enumValueId(parentRefKey, raw) };
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
 * Enum fields (`shape: "enum"`) get special handling — Source is shape-
 * derived, not type-derived (works regardless of whether the author
 * overrode the Type via `sitecore.type`):
 *   - **Inline enum** (no `enumHandle`): Source resolves at apply-time
 *     to the per-field enum folder via `ref-recipe` to
 *     `inlineEnumFolderId(site, recipeHandle, field.name)`. The folder
 *     and its value-item children are emitted by `buildFieldOp`. (Prior
 *     to 2026-05 this returned `query:./*` and inline enum values were
 *     parented under the field-definition item — but `query:` Source
 *     doesn't resolve in SXA Headless rendering parameter dialogs, so
 *     dropdowns came up empty.)
 *   - **Shared enum** (`sitecore.enumHandle` set): Source resolves at
 *     apply-time to the path of the EnumerationRecipe's folder item via
 *     `ref-recipe` to `enumerationFolderId(site, enumHandle)`.
 */
function resolveFieldSource(
  field: FieldDefinition | ParamDefinition,
  type: SitecoreFieldType,
  site: string,
  recipeHandle: string
): RefValue | undefined {
  const sc = field.sitecore;
  if (sc) {
    const fields = {
      sourceTypes: sc.sourceTypes,
      sourceQuery: sc.sourceQuery,
      sourceScope: sc.sourceScope,
      sourceRaw: sc.sourceRaw,
    };
    if (sourceFieldsNeedHandleResolution(fields)) {
      return {
        kind: "ref-source-fields",
        site,
        sourceTypes: sc.sourceTypes!,
        sourceQuery: sc.sourceQuery,
        sourceScope: sc.sourceScope,
      };
    }
    const rendered = renderSourceFields(fields, () => {
      throw createCliError("compile-time render should not need handle resolution", "UNKNOWN");
    });
    if (rendered !== undefined) {
      return { kind: "string", value: rendered };
    }
  }
  if (field.shape === "enum") {
    if (sc?.enumHandle) {
      // Shared enum — the executor resolves the refKey to the
      // enumeration folder's apply-time path so the Droplink Source
      // points at the right tenant location.
      return { kind: "ref-recipe", refKey: enumerationFolderId(site, sc.enumHandle) };
    }
    // Inline enum — same shape as shared, just scoped to a per-(recipe,
    // field) folder under <enumerationsRoot>. Same `ref-recipe`
    // resolution mechanism so SXA's editor enumerates the folder's
    // children at edit time.
    return {
      kind: "ref-recipe",
      refKey: inlineEnumFolderId(site, recipeHandle, field.name),
    };
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
