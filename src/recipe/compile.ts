import {
  componentFolderStandardValuesId,
  componentFolderTemplateId,
  componentFoldersBucketId,
  contentItemId,
  contentModelsGroupFolderId,
  dictionaryPhraseId,
  fieldId,
  PAGE_DESIGNS_ROOT_REF_KEY,
  pageDesignId,
  paramsFieldId,
  paramsSectionId,
  paramsTemplateId,
  partialDesignId,
  presentationParametersBucketId,
  renderingId,
  renderingsSectionFolderId,
  sectionDefinitionId,
  sectionFolderId,
  sectionId,
  siteId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "./guids";
import {
  type AppendToMultiListOp,
  type CreateItemOp,
  type CreateSiteFromTemplateOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type PushPolicy,
  type RefValue,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "./ir/operations";
import { defaultPolicyForRecipe, policyFor } from "./policy";
import {
  COMPOSITION_FIELDS,
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  DICTIONARY_ENTRY_FIELDS,
  LAYOUT_FIELDS,
  RENDERING_FIELDS,
  SECTION_DEFINITION_FIELDS,
  SITECORE_TEMPLATES,
  SITE_TEMPLATE_FIELDS,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "./ir/sitecore-templates";
import {
  type ComponentTemplateRecipe,
  ComponentTemplateRecipeSchema,
  type ContentFieldValue,
  type ContentItemRecipe,
  ContentItemRecipeSchema,
  type ContentTemplateRecipe,
  ContentTemplateRecipeSchema,
  type FieldDefinition,
  type PageDesignRecipe,
  PageDesignRecipeSchema,
  type ParamDefinition,
  type ParametersTemplateRecipe,
  ParametersTemplateRecipeSchema,
  type PartialDesignRecipe,
  PartialDesignRecipeSchema,
  type Recipe,
  RecipeSchema,
  type SectionDefinitionRecipe,
  SectionDefinitionRecipeSchema,
  type SiteRecipe,
  SiteRecipeSchema,
  type SiteTemplateRecipe,
  SiteTemplateRecipeSchema,
} from "./schema/recipe";
import {
  defaultSitecoreFieldType,
  type SitecoreFieldType,
  sitecoreFieldTypeLabel,
} from "./schema/field-types";
import { renderSourceFields, sourceFieldsNeedHandleResolution } from "./schema/source-fields";
import { emitLayoutXml } from "./layout/emit";
import { encodeTemplatesMapping } from "./layout/templates-mapping";

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
}

const PARAMS_SECTION_NAME = "Parameters";
const DEFAULT_FIELDS_SECTION = "Content";
const VARIANTS_FOLDER_NAME = "Variants";

/**
 * SXA Section Definition's "Available Renderings" multi-list field —
 * the lookup key the executor uses to read/append values when
 * applying `AppendToMultiList` ops emitted from `availableIn`.
 *
 * The GUID is a placeholder until sandbox introspection lands; the
 * executor matches by `fieldName` when the IR carries one (recipe-
 * authored fields share this property), so the placeholder is
 * tolerated for now.
 */
const AVAILABLE_RENDERINGS_FIELD_ID = SECTION_DEFINITION_FIELDS.AVAILABLE_RENDERINGS;
const AVAILABLE_RENDERINGS_FIELD_NAME = "Available Renderings";

/**
 * Compiler-default `OtherProperties` on every emitted rendering. Recipe
 * `rendering.otherProperties` overrides keys here on a per-key basis.
 * `IsAutoDatasourceRendering` is true on every reference recipe (cta-button,
 * badge-block, card-block) — hoisted so authors don't repeat themselves.
 */
const DEFAULT_OTHER_PROPERTIES: Record<string, string> = {
  IsAutoDatasourceRendering: "true",
};

const joinPath = (parent: string, name: string): string => {
  const trimmed = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${trimmed}/${name}`;
};

const COMPONENT_FOLDERS_BUCKET = "Component Folders";
const PRESENTATION_PARAMETERS_BUCKET = "Presentation Parameters";

/**
 * Resolve the parent path under which a `ComponentTemplateRecipe`'s
 * template item lands.
 *
 *   - With section + componentsRoot → `<componentsRoot>/<section>` (new layout).
 *   - With section only → `<templatesRoot>/<section>` (mid-migration fallback).
 *   - Without section → `<templatesRoot>` (legacy flat layout).
 */
const resolveComponentTemplateParent = (
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
const resolveComponentFoldersBucketPath = (context: CompileContext, section: string): string =>
  joinPath(resolveComponentTemplateParent(context, section), COMPONENT_FOLDERS_BUCKET);

/**
 * Resolve the parent path for a Presentation Parameters template —
 * `<sectionRoot>/Presentation Parameters/`. When the recipe lacks a
 * section (legacy callers), parameters templates land directly under
 * `templatesRoot` to match the old flat layout.
 */
const resolvePresentationParametersBucketPath = (
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
const resolveRenderingParent = (context: CompileContext, section: string | undefined): string =>
  section ? joinPath(context.renderingsRoot, section) : context.renderingsRoot;

/** Site name for deterministic folder refKeys. */
const siteOf = (context: CompileContext): string => context.site ?? "default";

/**
 * Ensure a section folder (under `componentsRoot/<section>`) exists.
 * Idempotent: emits a CreateOnly CreateItem op the first time a given
 * (site, section) pair is seen and records the refKey in the
 * `emittedFolders` set so subsequent calls are no-ops.
 *
 * Returns the section folder's refKey for downstream callers that want
 * to nest items under it.
 */
const ensureSectionFolder = (
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
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a "Component Folders" subfolder exists under the section
 * folder. Idempotent.
 */
const ensureComponentFoldersBucket = (
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
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a "Presentation Parameters" subfolder exists under the section
 * folder. Idempotent.
 */
const ensurePresentationParametersBucket = (
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
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a section subfolder under the renderings tree exists —
 * `<renderingsRoot>/<section>/`. Mirrors the templates side; the
 * rendering tree shape mirrors the template tree per the layout plan.
 */
const ensureRenderingsSectionFolder = (
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
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: section,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a Content Models group folder exists. Returns the refKey for
 * downstream `CreateItem.parent` references. Idempotent across
 * repeated calls within one recipe-set compile.
 */
const ensureContentModelsGroupFolder = (
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
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Compile a `ComponentTemplateRecipe` to an Operation IR.
 *
 * Pure: same recipe + same context → identical IR forever. The Authoring
 * API server-assigns itemIds on `createItem`, so the IR carries Sitecore
 * `path` fields for lookups + recipe-internal `refKey` GUIDs (uuidv5)
 * which the executor uses as the key into a per-run captured-itemId map.
 *
 * Layout (per `plans/recipe-site-folder-layout.md`):
 *
 *   With `section: "ui"`:
 *     - Section folder (CreateOnly) at `<componentsRoot>/ui`
 *     - Template at `<componentsRoot>/ui/<Component>`
 *     - When recipe declares `children:`, a Component Folder template at
 *       `<componentsRoot>/ui/Component Folders/<Component> Folder`
 *     - Inline `params:` (or `parameters: { handle }`) → Parameters
 *       template at `<componentsRoot>/ui/Presentation Parameters/<name>`
 *     - Renderings-side section folder (CreateOnly) at
 *       `<renderingsRoot>/ui`, then rendering at
 *       `<renderingsRoot>/ui/<Component>`
 *     - For each handle in `availableIn`, an `AppendToMultiList` op
 *       against the section definition's Available Renderings field
 *
 *   Without `section` (legacy back-compat):
 *     - Flat layout — template at `<templatesRoot>/<Component>`,
 *       parameters at `<templatesRoot>/<Component> Parameters`,
 *       rendering at `<renderingsRoot>/<Component>`. No section folder
 *       creation, no Component Folder generation.
 */
export function compileComponentTemplateRecipe(
  input: ComponentTemplateRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = ComponentTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const icon = DEFAULT_ICON;

  if (recipe.section) {
    ensureSectionFolder(operations, context, recipe.section, emittedFolders);
  }

  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
      // Component templates always sit at the section root (or
      // templatesRoot, for legacy callers).
      parentPath: resolveComponentTemplateParent(context, recipe.section),
    },
    context,
    icon,
    policy
  );

  if (recipe.children) {
    emitComponentFolderTemplate(operations, recipe, context, icon, emittedFolders);
  }

  // Parameter template emission:
  //   - If `recipe.parameters` is set, the rendering points at that
  //     external parameters template (no synthesis here).
  //   - Else if inline `params:` non-empty, synthesise an anonymous
  //     parameters template at the section-local Presentation
  //     Parameters bucket (or templatesRoot for legacy).
  const hasInlineParams = recipe.params.length > 0 && !recipe.parameters;
  if (hasInlineParams) {
    emitParamsTemplate(operations, recipe, context, icon, policy, emittedFolders);
  }

  if (recipe.section) {
    ensureRenderingsSectionFolder(operations, context, recipe.section, emittedFolders);
  }

  emitRendering(
    operations,
    recipe,
    context,
    icon,
    hasInlineParams || recipe.parameters !== undefined,
    policy
  );

  if (recipe.variants.length > 0) {
    emitVariants(operations, recipe, context, icon, policy);
  }

  if (recipe.availableIn && recipe.availableIn.length > 0) {
    emitAvailableInBindings(operations, recipe, policy);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Emit `AppendToMultiList` ops binding this rendering's GUID into the
 * `Available Renderings` field of each section definition listed in
 * `recipe.availableIn`. Idempotent under `merge-unique` policy.
 */
function emitAvailableInBindings(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  policy: PushPolicy
): void {
  const availableIn = recipe.availableIn ?? [];
  for (const sectionDefinitionHandle of availableIn) {
    operations.push({
      op: "AppendToMultiList",
      policy,
      label: `available-in:${recipe.handle}->${sectionDefinitionHandle}`,
      itemRefKey: sectionDefinitionId(sectionDefinitionHandle),
      fieldId: AVAILABLE_RENDERINGS_FIELD_ID,
      fieldName: AVAILABLE_RENDERINGS_FIELD_NAME,
      values: [{ kind: "ref-recipe", refKey: renderingId(recipe.handle) }],
      appendPolicy: "merge-unique",
    } satisfies AppendToMultiListOp);
  }
}

/**
 * Emit the `<Component> Folder` template under
 * `<componentsRoot>/<section>/Component Folders/`. Creates the
 * companion section folders idempotently. The folder template's
 * `__Standard Values` carries the Insert Options multi-list of allowed
 * child handles.
 */
function emitComponentFolderTemplate(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  emittedFolders: Set<string>
): void {
  if (!recipe.section) {
    // Without a section we can't pick a sensible parent folder; skip
    // emission and let the validator surface the missing section.
    return;
  }
  if (!recipe.children) return;

  const policy = defaultPolicyForRecipe(recipe.kind);
  const bucketRefKey = ensureComponentFoldersBucket(
    operations,
    context,
    recipe.section,
    emittedFolders
  );

  const folderName = `${recipe.name} Folder`;
  const folderTplRefKey = componentFolderTemplateId(recipe.handle);
  const folderTplPath = joinPath(
    resolveComponentFoldersBucketPath(context, recipe.section),
    folderName
  );

  operations.push({
    op: "CreateItem",
    policy,
    label: `component-folder-template:${recipe.handle}`,
    id: folderTplRefKey,
    path: folderTplPath,
    parent: { kind: "ref-recipe", refKey: bucketRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE,
    name: folderName,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
        kind: "string",
        value: `${recipe.displayName} Folder`,
      }),
    ],
  } satisfies CreateItemOp);

  // Folder templates inherit Standard Template (no custom fields).
  operations.push({
    op: "SetBaseTemplates",
    policy,
    label: `component-folder-base-templates:${recipe.handle}`,
    itemRefKey: folderTplRefKey,
    baseTemplates: [STANDARD_TEMPLATE_ID],
  } satisfies SetBaseTemplatesOp);

  // Standard Values item — the Insert Options field we set below lives
  // here, not on the template item itself.
  const svRefKey = componentFolderStandardValuesId(recipe.handle);
  const svPath = joinPath(folderTplPath, "__Standard Values");
  operations.push({
    op: "CreateItem",
    policy,
    label: `component-folder-standard-values:${recipe.handle}`,
    id: svRefKey,
    path: svPath,
    parent: { kind: "ref-recipe", refKey: folderTplRefKey },
    templateOf: folderTplRefKey,
    name: "__Standard Values",
    fields: [],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetStandardValues",
    policy,
    label: `link-component-folder-standard-values:${recipe.handle}`,
    templateRefKey: folderTplRefKey,
    standardValuesRefKey: svRefKey,
  } satisfies SetStandardValuesOp);

  operations.push({
    op: "SetField",
    policy,
    label: `component-folder-insert-options:${recipe.handle}`,
    itemRefKey: svRefKey,
    fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
    value: {
      kind: "ref-recipe-list",
      refKeys: recipe.children.allowedHandles.map((handle) => templateId(handle)),
    },
  } satisfies SetFieldOp);
}

/**
 * Compile a `ContentTemplateRecipe` to an Operation IR.
 *
 * Content templates are data-only: a Sitecore template + sections + fields
 * + standard values + back-fill. No rendering, no params, no variants.
 *
 * Path resolution:
 *   - With `contentModelsRoot` and `meta.tax.group` set →
 *     `<contentModelsRoot>/<group>/<name>` (group folder created
 *     idempotently as a CreateOnly op).
 *   - With `contentModelsRoot` and no group → `<contentModelsRoot>/<name>`.
 *   - Without `contentModelsRoot` → legacy `<templatesRoot>/<name>`.
 */
export function compileContentTemplateRecipe(
  input: ContentTemplateRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = ContentTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];

  const group = recipe.meta?.tax?.group;
  let parentPath: string | undefined;
  let parentRefKey: string | undefined;
  if (context.contentModelsRoot) {
    if (group) {
      const groupRefKey = ensureContentModelsGroupFolder(
        operations,
        context,
        group,
        emittedFolders
      );
      parentPath = joinPath(context.contentModelsRoot, group);
      parentRefKey = groupRefKey;
    } else {
      parentPath = context.contentModelsRoot;
    }
  }

  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
      ...(parentPath !== undefined && { parentPath }),
      ...(parentRefKey !== undefined && { parentRefKey }),
    },
    context,
    DEFAULT_ICON,
    defaultPolicyForRecipe(recipe.kind)
  );

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a standalone `ParametersTemplateRecipe` to an Operation IR.
 *
 * Lands at
 * `<componentsRoot>/<section>/Presentation Parameters/<name>` —
 * mirrors the layout that the synthesised inline parameters template
 * uses, so a standalone recipe and an inline-hoisted one occupy the
 * same Sitecore path.
 */
export function compileParametersTemplateRecipe(
  input: ParametersTemplateRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  const recipe = ParametersTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const icon = recipe.icon ?? DEFAULT_ICON;

  ensureSectionFolder(operations, context, recipe.section, emittedFolders);
  const bucketRefKey = ensurePresentationParametersBucket(
    operations,
    context,
    recipe.section,
    emittedFolders
  );
  const parentPath = resolvePresentationParametersBucketPath(context, recipe.section);

  // The standalone parameters template lands at the same identity
  // (paramsTemplateId) as inline-hoisted ones — keeps re-pushes
  // idempotent if a recipe migrates from inline to standalone.
  const tplRefKey = paramsTemplateId(recipe.handle);
  const tplPath = joinPath(parentPath, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `parameters-template:${recipe.handle}`,
    id: tplRefKey,
    path: tplPath,
    parent: { kind: "ref-recipe", refKey: bucketRefKey },
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
    label: `parameters-base-templates:${recipe.handle}`,
    itemRefKey: tplRefKey,
    baseTemplates: [STANDARD_TEMPLATE_ID],
  } satisfies SetBaseTemplatesOp);

  const secRefKey = paramsSectionId(recipe.handle, PARAMS_SECTION_NAME);
  const secPath = joinPath(tplPath, PARAMS_SECTION_NAME);
  operations.push({
    op: "CreateItem",
    policy,
    label: `parameters-section:${recipe.handle}/${PARAMS_SECTION_NAME}`,
    id: secRefKey,
    path: secPath,
    parent: { kind: "ref-recipe", refKey: tplRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
    name: PARAMS_SECTION_NAME,
    fields: [],
  } satisfies CreateItemOp);

  recipe.params.forEach((param, index) => {
    operations.push(
      buildFieldOp({
        recipeHandle: recipe.handle,
        fieldRefKey: paramsFieldId(recipe.handle, param.name),
        fieldPath: joinPath(secPath, param.name),
        parentRefKey: secRefKey,
        labelPrefix: `parameters-field:${recipe.handle}`,
        field: param,
        zeroBasedIndex: index,
        policy,
      })
    );
  });

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `SectionDefinitionRecipe` to an Operation IR.
 *
 * Section definitions are typically pre-existing tenant scaffolding —
 * the compiler does NOT emit a CreateItem op for them. Instead, the
 * recipe's `sitePath` is registered as a cross-recipe ref so the
 * executor's `seedCrossRecipeRefs` can resolve the existing item's
 * Sitecore itemId at apply time. For now this compiler returns an
 * empty IR; downstream `compileRecipeSet` handles the cross-recipe
 * ref pre-seeding via `extractCrossRecipeSeeds()` (separate plan).
 *
 * The recipe is still validated here so authors get schema feedback.
 */
export function compileSectionDefinitionRecipe(
  input: SectionDefinitionRecipe,
  _context: CompileContext
): OperationIr {
  const recipe = SectionDefinitionRecipeSchema.parse(input);
  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations: [],
  });
}

/**
 * Compile a `PartialDesignRecipe` to an Operation IR.
 *
 * Emits two ops:
 *   1. `CreateItem` for the partial-design item (SXA Partial Design template)
 *   2. `SetField` writing the layout XML to `__Renderings` (shared layout)
 *
 * The compiler resolves component / content-item handles in the layout
 * to deterministic GUIDs at compile time — no executor-side handle
 * resolution required for the layout body. (Page-template handles in
 * `appliesTo` and partial handles in `partials[]` on `PageDesignRecipe`
 * resolve the same way.)
 */
export function compilePartialDesignRecipe(
  input: PartialDesignRecipe,
  context: CompileContext
): OperationIr {
  const recipe = PartialDesignRecipeSchema.parse(input);
  if (!context.partialDesignsRoot) {
    throw new Error(
      `compilePartialDesignRecipe requires context.partialDesignsRoot; tenant-side path missing for recipe ${recipe.handle}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = partialDesignId(recipe.handle);
  const itemPath = joinPath(context.partialDesignsRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `partial-design:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.partialDesignsRoot },
    templateOf: SITECORE_TEMPLATES.PARTIAL_DESIGN,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  const layoutXml = emitLayoutXml(recipe.layout, {
    parentItemId: itemRefKey,
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: renderingId,
    contentItemIdFor: contentItemId,
    allowScoped: false,
    // SXA Partial Design's Layout pipeline normalizes canonical input
    // into delta form on first write — emit delta directly so first
    // push converges in one cycle (commit 6404024 documented the
    // two-cycle workaround; this is its Phase 5 follow-up).
    mode: "delta",
  });

  if (layoutXml.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `partial-design-layout:${recipe.handle}`,
      itemRefKey,
      fieldId: LAYOUT_FIELDS.RENDERINGS,
      value: { kind: "string", value: layoutXml },
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `PageDesignRecipe` to an Operation IR.
 *
 * Emits up to three ops:
 *   1. `CreateItem` for the page-design item (SXA Page Design template)
 *   2. `SetField(PartialDesigns)` — pipe-separated GUID list of partials
 *   3. `SetField(__Renderings)` — only when recipe.layout is non-empty
 *
 * The recipe's `appliesTo` contributions to the Page Designs root's
 * `TemplatesMapping` field are NOT emitted here — that field is
 * cross-recipe (every page design contributes a slice) and a per-recipe
 * `kind: "string"` write would full-replace under the executor's write
 * semantics, with each page design overwriting its siblings. Use
 * `compileRecipeSet` (below) to compile a coherent set of recipes —
 * it aggregates `appliesTo` contributions across every page-design
 * recipe in the set into one combined IR.
 */
export function compilePageDesignRecipe(
  input: PageDesignRecipe,
  context: CompileContext
): OperationIr {
  const recipe = PageDesignRecipeSchema.parse(input);
  if (!context.pageDesignsRoot) {
    throw new Error(
      `compilePageDesignRecipe requires context.pageDesignsRoot; tenant-side path missing for recipe ${recipe.handle}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = pageDesignId(recipe.handle);
  const itemPath = joinPath(context.pageDesignsRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `page-design:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.pageDesignsRoot },
    templateOf: SITECORE_TEMPLATES.PAGE_DESIGN,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  if (recipe.partials.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `page-design-partials:${recipe.handle}`,
      itemRefKey,
      fieldId: COMPOSITION_FIELDS.PARTIAL_DESIGNS,
      value: {
        kind: "ref-recipe-list",
        refKeys: recipe.partials.map((handle) => partialDesignId(handle)),
      },
    } satisfies SetFieldOp);
  }

  if (recipe.layout && Object.keys(recipe.layout.placeholders).length > 0) {
    const layoutXml = emitLayoutXml(recipe.layout, {
      parentItemId: itemRefKey,
      deviceId: DEFAULT_DEVICE_ID,
      renderingIdFor: renderingId,
      contentItemIdFor: contentItemId,
      allowScoped: false,
      // Page Design preserves canonical input on read-back — keep emitting
      // canonical so the layout XML round-trips byte-for-byte.
      mode: "canonical",
    });
    if (layoutXml.length > 0) {
      operations.push({
        op: "SetField",
        policy,
        label: `page-design-layout:${recipe.handle}`,
        itemRefKey,
        fieldId: LAYOUT_FIELDS.RENDERINGS,
        value: { kind: "string", value: layoutXml },
      } satisfies SetFieldOp);
    }
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `ContentItemRecipe` to an Operation IR.
 *
 * Emits one `CreateItem` for the content item plus one `SetField` per
 * field value. The item's `templateOf` resolves via `templateId(templateType)`
 * — the corresponding `ContentTemplateRecipe` (or `ComponentTemplateRecipe`)
 * must ship in the same set so the executor's captured-itemId map carries
 * its server-assigned GUID at apply time. The cross-recipe validator
 * (`validateRecipeSet`) catches missing template references before push.
 *
 * Field values dispatch on `shape` to one of the encoders below. Most
 * shapes encode at compile time to a `kind: "string"` value (Sitecore's
 * stored representation is always a string); `reference` shapes emit
 * `kind: "ref-recipe-list"` so the executor substitutes captured itemIds
 * at apply time.
 *
 * Phase 4 v1 limitations:
 *  - `link-internal` is deferred — the wire format is XML wrapping a
 *    refKey-resolved GUID, which requires a new RefValue kind. Authors
 *    should use `reference` (with a single-element `refs` array) for
 *    Droplink/Reference fields, or `link-external` for external URLs.
 *  - `image.mediaPath` is treated as an opaque path — no media-item
 *    upload. Sitecore renders the field if a media library item exists
 *    at that path; otherwise the field is empty until media seeding
 *    lands in Phase 5+.
 */
export function compileContentItemRecipe(
  input: ContentItemRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ContentItemRecipeSchema.parse(input);
  if (!context.contentItemsRoot) {
    throw new Error(
      `compileContentItemRecipe requires context.contentItemsRoot; tenant-side path missing for recipe ${recipe.handle}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = contentItemId(recipe.handle);
  const itemPath = joinPath(context.contentItemsRoot, recipe.name);
  const templateRefKey = templateId(recipe.templateType);

  operations.push({
    op: "CreateItem",
    policy,
    label: `content-item:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.contentItemsRoot },
    // String GUID — the executor treats this as a refKey when it matches a
    // captured-itemId entry (the ContentTemplateRecipe / ComponentTemplateRecipe
    // for `recipe.templateType` registers `templateId(handle)` at apply
    // time), else as a literal Sitecore template GUID.
    templateOf: templateRefKey,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  for (const [fieldName, fieldValue] of Object.entries(recipe.fields)) {
    const value = encodeContentFieldValue(fieldValue, recipe.handle);
    if (value === null) continue;
    const fieldGuid = fieldId(recipe.templateType, fieldName);
    operations.push({
      op: "SetField",
      policy,
      label: `content-item-field:${recipe.handle}:${fieldName}`,
      itemRefKey,
      fieldId: fieldGuid,
      // Recipe-created field — Sitecore assigns its own GUID to the
      // Template Field item, so fieldGuid is only an IR-internal refKey.
      // The mutation needs the human-readable name; planner uses it for
      // diff matching against the remote item's field-by-name.
      fieldName,
      // Versioned: content-item field values are language/version-scoped.
      // Default language/version are filled in by versionedField helper —
      // duplicating its shape here so the SetField op carries them.
      language: DEFAULT_LANGUAGE,
      version: DEFAULT_VERSION,
      value,
    } satisfies SetFieldOp);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Format a recipe `date` (ISO `YYYY-MM-DD`) or `datetime` (ISO 8601 with
 * timezone) into Sitecore's stored format `yyyyMMddTHHmmssZ`.
 */
const toSitecoreDate = (iso: string, kind: "date" | "datetime"): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`ContentFieldValue ${kind}: '${iso}' is not a valid ISO date`);
  }
  if (kind === "date") {
    // Date-only — pin to UTC midnight to keep the output deterministic
    // regardless of host timezone.
    const isoDateOnly = iso.includes("T") ? iso.slice(0, 10) : iso;
    return `${isoDateOnly.replace(/-/g, "")}T000000Z`;
  }
  // Datetime: yyyyMMddTHHmmssZ in UTC.
  const yyyy = parsed.getUTCFullYear().toString().padStart(4, "0");
  const MM = (parsed.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = parsed.getUTCDate().toString().padStart(2, "0");
  const HH = parsed.getUTCHours().toString().padStart(2, "0");
  const mm = parsed.getUTCMinutes().toString().padStart(2, "0");
  const ss = parsed.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${MM}${dd}T${HH}${mm}${ss}Z`;
};

/**
 * Sitecore image-field XML. Phase 4 v1 emits `mediapath` only — see
 * `compileContentItemRecipe` JSDoc for the media-item upload caveat.
 */
const encodeImageXml = (img: {
  mediaPath: string;
  alt?: string;
  width?: number;
  height?: number;
}): string => {
  const attrs: string[] = [`mediapath="${escapeXmlAttr(img.mediaPath)}"`];
  if (img.alt !== undefined) attrs.push(`alt="${escapeXmlAttr(img.alt)}"`);
  if (img.width !== undefined) attrs.push(`width="${img.width}"`);
  if (img.height !== undefined) attrs.push(`height="${img.height}"`);
  return `<image ${attrs.join(" ")} />`;
};

/**
 * Sitecore General Link XML for an external URL (`linktype="external"`).
 */
const encodeExternalLinkXml = (link: {
  href: string;
  text?: string;
  target?: string;
  title?: string;
}): string => {
  const attrs: string[] = [`linktype="external"`, `url="${escapeXmlAttr(link.href)}"`];
  if (link.text !== undefined) attrs.push(`text="${escapeXmlAttr(link.text)}"`);
  if (link.target !== undefined) attrs.push(`target="${escapeXmlAttr(link.target)}"`);
  if (link.title !== undefined) attrs.push(`title="${escapeXmlAttr(link.title)}"`);
  return `<link ${attrs.join(" ")} />`;
};

const escapeXmlAttr = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Encode one ContentFieldValue to a RefValue. Returns null when the
 * shape is deferred (e.g. `link-internal` in Phase 4 v1) — the caller
 * skips emitting a SetField op for it. Throws on truly invalid input.
 */
const encodeContentFieldValue = (
  value: ContentFieldValue,
  recipeHandle: string
): RefValue | null => {
  switch (value.shape) {
    case "text":
    case "richText":
    case "enum":
      return { kind: "string", value: value.value };
    case "boolean":
      return { kind: "bool", value: value.value };
    case "number":
    case "integer":
      return { kind: "number", value: value.value };
    case "date":
    case "datetime":
      return { kind: "string", value: toSitecoreDate(value.value, value.shape) };
    case "image":
      return { kind: "string", value: encodeImageXml(value) };
    case "link-external":
      return { kind: "string", value: encodeExternalLinkXml(value) };
    case "link-internal":
      // Deferred: General Link XML wrapping a refKey-resolved GUID needs
      // a new RefValue kind. Recipe authors targeting Phase 4 should use
      // `reference` (single-element refs[]) for Droplink-shaped fields.
      throw new Error(
        `ContentItemRecipe '${recipeHandle}': link-internal is deferred to Phase 5. ` +
          `Use 'reference' shape with a single-element refs[] for Droplink/Reference fields, ` +
          `or 'link-external' with an absolute URL for now.`
      );
    case "reference":
      return {
        kind: "ref-recipe-list",
        refKeys: value.refs.map((handle) => contentItemId(handle)),
      };
  }
};

/**
 * Stable handle for the synthetic IR `compileRecipeSet` emits to write
 * the cross-recipe `TemplatesMapping` aggregate. Not a real recipe — the
 * leading double-underscore signals "compiler-synthesized" and avoids
 * collision with any author-defined handle (recipe handles match
 * `[a-z][a-z0-9-]*@\d+`, so a leading underscore is unrepresentable).
 */
export const TEMPLATES_MAPPING_AGGREGATE_HANDLE = "__templates-mapping__";

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
  const irs: OperationIr[] = recipes.map((recipe) => {
    switch (recipe.kind) {
      case "component-template":
        return compileComponentTemplateRecipe(recipe, context, emittedFolders);
      case "content-template":
        return compileContentTemplateRecipe(recipe, context, emittedFolders);
      case "parameters-template":
        return compileParametersTemplateRecipe(recipe, context, emittedFolders);
      default:
        return compileRecipe(recipe, context);
    }
  });

  const entries: { templateGuid: string; designGuid: string }[] = [];
  for (const recipe of recipes) {
    if (recipe.kind !== "page-design") continue;
    if (recipe.appliesTo.length === 0) continue;
    const designGuid = pageDesignId(recipe.handle);
    for (const tplHandle of recipe.appliesTo) {
      entries.push({ templateGuid: templateId(tplHandle), designGuid });
    }
  }

  if (entries.length === 0) {
    return irs;
  }

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

  return irs;
}

/**
 * Compile a `SiteTemplateRecipe` to an Operation IR.
 *
 * Phase 5 Milestone C-extra refinement — emits the SiteTemplate item
 * (a `Solution template`-typed item under `siteTemplatesRoot`) with
 * the fields SXA's createSite flow actually reads: Name, Description,
 * Enabled, Built-in template marker, plus stub ICON / DISPLAY_NAME.
 *
 * **Design gap (acknowledged, not closed by this commit):** the
 * `SiteTemplateRecipe` schema models brand shape as direct lists of
 * page templates, page designs, an insert-options matrix, a
 * templates-to-designs mapping, dictionary entries, and taxonomy
 * roots. SXA's Solution template doesn't carry any of those directly
 * — it carries a `Site Modules` + `Tenant Modules` list of MODULE
 * item refs, and modules hold the brand structure. Mapping the
 * recipe schema's high-level fields to SXA modules is open work
 * (probably needs a `ModuleRecipe` kind, or a "modules" array on
 * SiteTemplateRecipe that resolves to existing module item GUIDs).
 *
 * Sandbox introspection (2026-05-01) confirmed:
 *   - SXA "Site Template" = item conforming to `Solution template`
 *     (templateId 1b2dfd3b-f2f2-4f40-a75c-f6c2490919c4)
 *   - Built-in templates live at `/sitecore/system/Settings/Foundation/
 *     JSS Experience Accelerator/Scaffolding/Templates`
 *   - Field GUIDs captured in SITE_TEMPLATE_FIELDS (sitecore-templates.ts)
 *
 * What this commit emits:
 *   - CreateItem with the correct `templateOf` GUID
 *   - SetField for Name (Solution-template's `Name` field, not __Display Name)
 *   - SetField for Description (when recipe.description is set)
 *   - SetField for Enabled = "1"
 *   - SetField for Built-in template = "0" (recipe-authored, not SXA-shipped)
 *
 * Deferred to a follow-up plan revision (because the recipe-schema-to-
 * SXA-modules mapping needs design):
 *   - Site Modules / Tenant Modules SetFields populated from the recipe's
 *     pageTemplates / pageDesigns / etc. (currently they need to map to
 *     existing module item GUIDs, which we don't yet)
 *   - Dictionary subitems (live under <site>/Dictionary, not under
 *     the site template; they're per-site, not per-template)
 *   - Taxonomy: no per-site Taxonomy folder found on the sandbox; the
 *     SXA convention may put taxonomy elsewhere or it may not be a
 *     site-template concern
 *
 * Identity: `templateId(handle)` derives the SiteTemplate item's
 * deterministic refKey.
 */
export function compileSiteTemplateRecipe(
  input: SiteTemplateRecipe,
  context: CompileContext
): OperationIr {
  const recipe = SiteTemplateRecipeSchema.parse(input);
  if (!context.siteTemplatesRoot) {
    throw new Error(
      `compileSiteTemplateRecipe requires context.siteTemplatesRoot; tenant-side path missing for recipe ${recipe.handle}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const itemRefKey = templateId(recipe.handle);
  const itemPath = joinPath(context.siteTemplatesRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `site-template:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.siteTemplatesRoot },
    templateOf: SITECORE_TEMPLATES.SITE_TEMPLATE,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  // Solution template's own `Name` field — distinct from __Display Name.
  // SXA's Sites UI reads this for the template chooser.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-name:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.NAME,
    value: { kind: "string", value: recipe.displayName },
  } satisfies SetFieldOp);

  if (recipe.description) {
    operations.push({
      op: "SetField",
      policy,
      label: `site-template-description:${recipe.handle}`,
      itemRefKey,
      fieldId: SITE_TEMPLATE_FIELDS.DESCRIPTION,
      value: { kind: "string", value: recipe.description },
    } satisfies SetFieldOp);
  }

  // Available for site creation by default.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-enabled:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.ENABLED,
    value: { kind: "string", value: "1" },
  } satisfies SetFieldOp);

  // "Built-in" is a marker for SXA-shipped templates — recipe-authored
  // ones explicitly mark themselves as not built-in so the Sites UI can
  // distinguish operator-authored brand templates from the canned ones.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-builtin:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.BUILT_IN_TEMPLATE,
    value: { kind: "string", value: "0" },
  } satisfies SetFieldOp);

  // TODO (next plan revision — needs design):
  //   - Module resolution. SXA stores brand structure in MODULES, not
  //     directly on the Solution template. recipe.pageTemplates,
  //     recipe.pageDesigns, recipe.insertOptionsMatrix,
  //     recipe.templatesToDesigns map to module composition that this
  //     compiler doesn't yet model. Site Modules + Tenant Modules
  //     SetFields would carry pipe-separated module-item GUIDs once
  //     the schema gains a module-references field (or a separate
  //     ModuleRecipe kind that the compiler can resolve to GUIDs).
  //   - Dictionary entries. Per-site Dictionary lives under
  //     <site>/Dictionary, not under the site template. SiteRecipe
  //     compile (Milestone D) is the right place to set those.
  //   - Taxonomy. No per-site Taxonomy folder discovered on the
  //     sandbox; the SXA convention isn't clear yet. Defer.

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/** Front-door dispatcher — accepts any registered recipe kind. */
export function compileRecipe(input: Recipe, context: CompileContext): OperationIr {
  const recipe = RecipeSchema.parse(input);
  switch (recipe.kind) {
    case "component-template":
      return compileComponentTemplateRecipe(recipe, context);
    case "content-template":
      return compileContentTemplateRecipe(recipe, context);
    case "content-item":
      return compileContentItemRecipe(recipe, context);
    case "parameters-template":
      return compileParametersTemplateRecipe(recipe, context);
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
  }
}

/**
 * Compile a `SiteRecipe` to an Operation IR.
 *
 * Phase 5 Milestone E — emits a single `CreateSiteFromTemplate` op
 * that the executor dispatches through the Sites API. The
 * `SiteTemplateRecipe` it references is identified via deterministic
 * `templateId(siteTemplate)`; the executor resolves that refKey to
 * the SiteTemplate's actual Sitecore itemId via cross-recipe ref
 * pre-seeding (push.ts walks every recipe's `CreateItem` ops and
 * seeds `crossRecipeRefs[refKey] = path`, then the executor's
 * `seedCrossRecipeRefs` calls `getItem({path})` once per push to
 * populate `capturedItemIds`).
 *
 * **Validates** (compile-time, not zod-level):
 *   - Exactly one of `collectionId` / `collectionName` is present.
 *
 * **Override emission (Milestone E v2):**
 *   - Dictionary overrides emit one `SetField` op per phrase, targeting
 *     `<collectionPath>/<siteName>/Dictionary/<phrase>`. Each op carries a
 *     `latePath` so the executor's pre-switch lookup seeds the captured
 *     itemId after `CreateSiteFromTemplate` materialises the site's
 *     content tree (SXA's Site Wizard creates the Dictionary folder +
 *     phrase items mid-push).
 *   - Path composition needs the collection's content-tree path. The
 *     compiler resolves it in this priority:
 *       1. `recipe.collectionPath` (operator-supplied — explicit truth)
 *       2. `/sitecore/content/<collectionName>` when only collectionName
 *          is set (SXA default; new collections land at this path)
 *     For `collectionId` callers without `collectionPath`, the compiler
 *     CAN'T derive the path (would need a Sites API lookup at compile
 *     time, which the compiler doesn't do). Override emission is
 *     skipped silently — the site still gets created; operators add
 *     `collectionPath` when they want overrides applied.
 *
 * **Still deferred (E v3+):**
 *   - Taxonomy overrides as a mix of SetField (existing tags) and
 *     CreateItem (new tags). The SXA taxonomy convention is still under
 *     sandbox investigation; defer until verified.
 */
export function compileSiteRecipe(input: SiteRecipe, _context: CompileContext): OperationIr {
  const recipe = SiteRecipeSchema.parse(input);

  const hasCollectionId = recipe.collectionId !== undefined;
  const hasCollectionName = recipe.collectionName !== undefined;
  if (hasCollectionId === hasCollectionName) {
    throw new Error(
      `SiteRecipe '${recipe.handle}' must specify exactly one of collectionId / collectionName, not ${hasCollectionId ? "both" : "neither"}.`
    );
  }

  const policy = defaultPolicyForRecipe(recipe.kind);
  const siteRefKey = siteId(recipe.handle);
  const templateRefKey = templateId(recipe.siteTemplate);

  const operations: Operation[] = [
    {
      op: "CreateSiteFromTemplate",
      policy,
      label: `site:${recipe.handle}`,
      siteRefKey,
      siteName: recipe.name,
      ...(recipe.displayName !== undefined && { displayName: recipe.displayName }),
      ...(recipe.description !== undefined && { description: recipe.description }),
      language: recipe.language,
      ...(recipe.languages !== undefined && { additionalLanguages: recipe.languages }),
      ...(recipe.siteGrouping?.hostName !== undefined && {
        hostName: recipe.siteGrouping.hostName,
      }),
      templateRefKey,
      ...(recipe.collectionId !== undefined && { collectionId: recipe.collectionId }),
      ...(recipe.collectionName !== undefined && { collectionName: recipe.collectionName }),
      ...(recipe.collectionDisplayName !== undefined && {
        collectionDisplayName: recipe.collectionDisplayName,
      }),
      ...(recipe.collectionDescription !== undefined && {
        collectionDescription: recipe.collectionDescription,
      }),
    } satisfies CreateSiteFromTemplateOp,
  ];

  // Resolve the site's content-tree path for late-path composition on
  // dictionary override ops. See docstring for resolution priority.
  const sitePath = resolveSiteContentTreePath(recipe);
  if (sitePath && recipe.dictionaryOverrides) {
    for (const [phrase, value] of Object.entries(recipe.dictionaryOverrides)) {
      operations.push({
        op: "SetField",
        policy,
        label: `dictionary-override:${recipe.handle}/${phrase}`,
        itemRefKey: dictionaryPhraseId(recipe.handle, phrase),
        fieldId: DICTIONARY_ENTRY_FIELDS.PHRASE,
        value: { kind: "string", value },
        latePath: `${sitePath}/Dictionary/${phrase}`,
      } satisfies SetFieldOp);
    }
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Resolve the Sitecore content-tree path of a SiteRecipe's site item.
 * Returns `undefined` when no path can be derived — the caller should
 * skip override emission rather than guess.
 *
 *   1. operator-supplied `recipe.collectionPath` (always wins)
 *   2. `/sitecore/content/<collectionName>` when only collectionName is set
 *   3. `undefined` for collectionId-only without collectionPath
 *
 * The trailing `/` is trimmed defensively from operator input.
 */
const resolveSiteContentTreePath = (recipe: SiteRecipe): string | undefined => {
  if (recipe.collectionPath) {
    const trimmed = recipe.collectionPath.replace(/\/+$/, "");
    return `${trimmed}/${recipe.name}`;
  }
  if (recipe.collectionName) {
    return `/sitecore/content/${recipe.collectionName}/${recipe.name}`;
  }
  return undefined;
};

interface DatasourceTemplateInput {
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
}

function emitDatasourceTemplate(
  operations: Operation[],
  recipe: DatasourceTemplateInput,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const tplRefKey = templateId(recipe.handle);
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
    baseTemplates: [STANDARD_TEMPLATE_ID],
  } satisfies SetBaseTemplatesOp);

  for (const group of groupFieldsBySection(recipe.fields)) {
    const secRefKey = sectionId(recipe.handle, group.section);
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
        buildFieldOp({
          recipeHandle: recipe.handle,
          fieldRefKey: fieldId(recipe.handle, field.name),
          fieldPath: joinPath(secPath, field.name),
          parentRefKey: secRefKey,
          labelPrefix: `field:${recipe.handle}`,
          field,
          zeroBasedIndex: index,
          policy,
        })
      );
    });
  }

  const svRefKey = standardValuesId(recipe.handle);
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
    fields: [],
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
        refKeys: recipe.insertOptions.map((handle) => templateId(handle)),
      },
    } satisfies SetFieldOp);
  }
}

function emitParamsTemplate(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  policy: PushPolicy,
  emittedFolders: Set<string>
): void {
  const paramsTplRefKey = paramsTemplateId(recipe.handle);
  const paramsName = `${recipe.name} Parameters`;
  const paramsDisplayName = `${recipe.displayName} Parameters`;

  let paramsParent: CreateItemOp["parent"];
  let paramsParentPath: string;
  if (recipe.section) {
    const bucketRefKey = ensurePresentationParametersBucket(
      operations,
      context,
      recipe.section,
      emittedFolders
    );
    paramsParent = { kind: "ref-recipe", refKey: bucketRefKey };
    paramsParentPath = resolvePresentationParametersBucketPath(context, recipe.section);
  } else {
    paramsParent = { kind: "ref-path", value: context.templatesRoot };
    paramsParentPath = context.templatesRoot;
  }
  const paramsTplPath = joinPath(paramsParentPath, paramsName);

  operations.push({
    op: "CreateItem",
    policy,
    label: `params-template:${recipe.handle}`,
    id: paramsTplRefKey,
    path: paramsTplPath,
    parent: paramsParent,
    templateOf: SITECORE_TEMPLATES.TEMPLATE,
    name: paramsName,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: paramsDisplayName }),
    ],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetBaseTemplates",
    policy,
    label: `params-base-templates:${recipe.handle}`,
    itemRefKey: paramsTplRefKey,
    baseTemplates: [STANDARD_TEMPLATE_ID],
  } satisfies SetBaseTemplatesOp);

  const paramsSecRefKey = paramsSectionId(recipe.handle, PARAMS_SECTION_NAME);
  const paramsSecPath = joinPath(paramsTplPath, PARAMS_SECTION_NAME);
  operations.push({
    op: "CreateItem",
    policy,
    label: `params-section:${recipe.handle}/${PARAMS_SECTION_NAME}`,
    id: paramsSecRefKey,
    path: paramsSecPath,
    parent: { kind: "ref-recipe", refKey: paramsTplRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_SECTION,
    name: PARAMS_SECTION_NAME,
    fields: [],
  } satisfies CreateItemOp);

  recipe.params.forEach((param, index) => {
    operations.push(
      buildFieldOp({
        recipeHandle: recipe.handle,
        fieldRefKey: paramsFieldId(recipe.handle, param.name),
        fieldPath: joinPath(paramsSecPath, param.name),
        parentRefKey: paramsSecRefKey,
        labelPrefix: `params-field:${recipe.handle}`,
        field: param,
        zeroBasedIndex: index,
        policy,
      })
    );
  });
}

function emitRendering(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  hasParams: boolean,
  policy: PushPolicy
): void {
  const renderingRefKey = renderingId(recipe.handle);
  const renderingParentPath = resolveRenderingParent(context, recipe.section);
  const renderingPath = joinPath(renderingParentPath, recipe.name);
  // Datasource template ref: prefer the explicit `datasource:` ref when
  // present (separate ContentTemplateRecipe under Content Models/);
  // otherwise the component template itself is the datasource template
  // (legacy inline-fields pattern).
  const datasourceRefKey = recipe.datasource
    ? templateId(recipe.datasource.handle)
    : templateId(recipe.handle);

  const fields: FieldValue[] = [
    sharedField(RENDERING_FIELDS.COMPONENT_NAME, { kind: "string", value: recipe.name }),
    sharedField(RENDERING_FIELDS.DATASOURCE_TEMPLATE, {
      kind: "ref-recipe",
      refKey: datasourceRefKey,
    }),
    sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
  ];

  if (hasParams) {
    // Prefer the explicit `parameters: { handle }` reference when set,
    // else point at the synthesised inline params template (whose
    // refKey is `paramsTemplateId(recipe.handle)`).
    const paramsRefKey = recipe.parameters
      ? paramsTemplateId(recipe.parameters.handle)
      : paramsTemplateId(recipe.handle);
    fields.push(
      sharedField(RENDERING_FIELDS.PARAMETERS_TEMPLATE, {
        kind: "ref-recipe",
        refKey: paramsRefKey,
      })
    );
  }

  if (recipe.rendering.datasourceLocation === "query" && recipe.rendering.datasourceLocationQuery) {
    fields.push(
      sharedField(RENDERING_FIELDS.DATASOURCE_LOCATION, {
        kind: "query",
        value: recipe.rendering.datasourceLocationQuery,
      })
    );
  } else if (recipe.rendering.datasourceLocation === "current-item") {
    fields.push(sharedField(RENDERING_FIELDS.DATASOURCE_LOCATION, { kind: "string", value: "." }));
  }

  fields.push(
    sharedField(RENDERING_FIELDS.OPEN_PROPERTIES_AFTER_ADD, {
      kind: "bool",
      value: recipe.rendering.openPropertiesAfterAdd,
    })
  );

  const otherProperties = {
    ...DEFAULT_OTHER_PROPERTIES,
    ...(recipe.rendering.otherProperties ?? {}),
  };
  fields.push(
    sharedField(RENDERING_FIELDS.OTHER_PROPERTIES, {
      kind: "url-string-map",
      entries: otherProperties,
    })
  );

  operations.push({
    op: "CreateItem",
    policy,
    label: `rendering:${recipe.handle}`,
    id: renderingRefKey,
    path: renderingPath,
    parent: { kind: "ref-path", value: renderingParentPath },
    templateOf: SITECORE_TEMPLATES.RENDERING,
    name: recipe.name,
    fields,
  } satisfies CreateItemOp);
}

function emitVariants(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const folderRefKey = variantsFolderId(recipe.handle);
  const renderingRefKey = renderingId(recipe.handle);
  const renderingParentPath = resolveRenderingParent(context, recipe.section);
  const renderingPath = joinPath(renderingParentPath, recipe.name);
  const folderPath = joinPath(renderingPath, VARIANTS_FOLDER_NAME);

  operations.push({
    op: "CreateItem",
    policy,
    label: `variants-folder:${recipe.handle}`,
    id: folderRefKey,
    path: folderPath,
    parent: { kind: "ref-recipe", refKey: renderingRefKey },
    templateOf: SITECORE_TEMPLATES.FOLDER,
    name: VARIANTS_FOLDER_NAME,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon })],
  } satisfies CreateItemOp);

  for (const variant of recipe.variants) {
    operations.push({
      op: "CreateItem",
      policy,
      label: `variant:${recipe.handle}/${variant.name}`,
      id: variantId(recipe.handle, variant.name),
      path: joinPath(folderPath, variant.name),
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: SITECORE_TEMPLATES.FOLDER,
      name: variant.name,
      fields: [versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: variant.name })],
    } satisfies CreateItemOp);
  }
}

interface BuildFieldOpInput {
  recipeHandle: string;
  fieldRefKey: string;
  fieldPath: string;
  parentRefKey: string;
  labelPrefix: string;
  field: FieldDefinition | ParamDefinition;
  zeroBasedIndex: number;
  policy: PushPolicy;
}

function buildFieldOp(input: BuildFieldOpInput): CreateItemOp {
  const { fieldRefKey, fieldPath, parentRefKey, labelPrefix, field, zeroBasedIndex, policy } =
    input;
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

  const sourceValue = resolveFieldSource(field, sitecoreType);
  if (sourceValue !== undefined) {
    fields.push(sharedField(TEMPLATE_FIELD_FIELDS.SOURCE, sourceValue));
  }

  return {
    op: "CreateItem",
    policy,
    label: `${labelPrefix}/${field.name}`,
    id: fieldRefKey,
    path: fieldPath,
    parent: { kind: "ref-recipe", refKey: parentRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FIELD,
    name: field.name,
    fields,
  } satisfies CreateItemOp;
}

function resolveSitecoreType(field: FieldDefinition | ParamDefinition): SitecoreFieldType {
  if (field.sitecore?.type) {
    return field.sitecore.type;
  }
  const multiple = "multiple" in field ? field.multiple : undefined;
  return defaultSitecoreFieldType(field.shape, multiple);
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
 */
function resolveFieldSource(
  field: FieldDefinition | ParamDefinition,
  type: SitecoreFieldType
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
        sourceTypes: sc.sourceTypes!,
        sourceQuery: sc.sourceQuery,
        sourceScope: sc.sourceScope,
      };
    }
    const rendered = renderSourceFields(fields, () => {
      throw new Error("compile-time render should not need handle resolution");
    });
    if (rendered !== undefined) {
      return { kind: "string", value: rendered };
    }
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

function sharedField(fieldGuid: string, value: FieldValue["value"]): FieldValue {
  return { fieldId: fieldGuid, value };
}

function versionedField(fieldGuid: string, value: FieldValue["value"]): FieldValue {
  return {
    fieldId: fieldGuid,
    language: DEFAULT_LANGUAGE,
    version: DEFAULT_VERSION,
    value,
  };
}
