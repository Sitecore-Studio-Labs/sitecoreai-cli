import {
  componentFolderStandardValuesId,
  componentFolderTemplateId,
  headlessVariantsSectionFolderId,
  paramsFieldId,
  paramsSectionId,
  paramsStandardValuesId,
  paramsTemplateId,
  renderingId,
  sectionDefinitionId,
  templateId,
  variantId,
  variantsFolderId,
} from "../guids";
import {
  type AppendToMultiListOp,
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type PushPolicy,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../policy";
import { createCliError } from "../../shared/errors";
import {
  DEFAULT_ICON,
  FOLDER_ICON,
  RENDERING_FIELDS,
  SECTION_DEFINITION_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SXA_COMPONENT_BASE_TEMPLATES,
  SXA_HEADLESS_PARAMS_BASE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type ComponentTemplateRecipe, ComponentTemplateRecipeSchema } from "../schema/recipe";
import {
  PARAMS_SECTION_NAME,
  buildFieldOp,
  buildStandardValuesFieldEntries,
  emitDatasourceTemplate,
  ensureComponentFoldersBucket,
  ensurePresentationParametersBucket,
  ensureRenderingsSectionFolder,
  ensureSectionFolder,
  joinPath,
  resolveComponentFoldersBucketPath,
  resolveComponentTemplateParent,
  resolvePresentationParametersBucketPath,
  resolveRenderingParent,
  sharedField,
  siteOf,
  versionedField,
  type CompileContext,
} from "./shared";

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
      // SXA Foundation bases (`_PerSiteStandardValues`,
      // `_HorizonDatasourceGrouping`, `_PublishingGroupingTemplate`) —
      // verified against live tenants on 2026-05-02. Without these the
      // SXA editor doesn't recognise the item as a component and
      // fields/standard-values won't surface in the Pages editor.
      additionalBaseTemplates: SXA_COMPONENT_BASE_TEMPLATES,
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
    emitVariants(operations, recipe, context, icon, policy, emittedFolders);
  }

  if (recipe.availableIn && recipe.availableIn.length > 0) {
    emitAvailableInBindings(operations, recipe, policy, siteOf(context));
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
  policy: PushPolicy,
  site: string
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
      values: [{ kind: "ref-recipe", refKey: renderingId(site, recipe.handle) }],
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
  const site = siteOf(context);
  const bucketRefKey = ensureComponentFoldersBucket(
    operations,
    context,
    recipe.section,
    emittedFolders
  );

  const folderName = `${recipe.name} Folder`;
  const folderTplRefKey = componentFolderTemplateId(site, recipe.handle);
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
  const svRefKey = componentFolderStandardValuesId(site, recipe.handle);
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
      refKeys: recipe.children.allowedHandles.map((handle) => templateId(site, handle)),
    },
  } satisfies SetFieldOp);
}

function emitParamsTemplate(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  policy: PushPolicy,
  emittedFolders: Set<string>
): void {
  const site = siteOf(context);
  const paramsTplRefKey = paramsTemplateId(site, recipe.handle);
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
    // Inherits the SXA Headless params bases (BaseRenderingParameters,
    // _PerSiteStandardValues, and the additional Headless marker)
    // verified by tenant introspection of a working SXA Headless
    // component (LinkList) — without these the params dialog stays
    // empty in Pages even though the template + fields exist.
    baseTemplates: [...SXA_HEADLESS_PARAMS_BASE_TEMPLATES],
  } satisfies SetBaseTemplatesOp);

  const paramsSecRefKey = paramsSectionId(site, recipe.handle, PARAMS_SECTION_NAME);
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
      ...buildFieldOp({
        recipeHandle: recipe.handle,
        recipeName: recipe.name,
        recipeDisplayName: recipe.displayName,
        enumerationsRoot: context.enumerationsRoot,
        fieldRefKey: paramsFieldId(site, recipe.handle, param.name),
        fieldPath: joinPath(paramsSecPath, param.name),
        parentRefKey: paramsSecRefKey,
        labelPrefix: `params-field:${recipe.handle}`,
        field: param,
        zeroBasedIndex: index,
        policy,
        site,
      })
    );
  });

  // Standard Values for the params template — pre-fills rendering
  // parameter defaults so authors see expected values in the parameters
  // dialog when first dropping the rendering. Only emitted when at
  // least one param declares a `default` / `sitecore.defaultValue`;
  // empty SV items are noise and would still resolve identical GUIDs
  // across pushes if added later.
  const paramsSvFieldEntries = buildStandardValuesFieldEntries(
    site,
    recipe.handle,
    recipe.params,
    paramsFieldId
  );
  if (paramsSvFieldEntries.length > 0) {
    const paramsSvRefKey = paramsStandardValuesId(site, recipe.handle);
    const paramsSvPath = joinPath(paramsTplPath, "__Standard Values");
    operations.push({
      op: "CreateItem",
      policy,
      label: `params-standard-values:${recipe.handle}`,
      id: paramsSvRefKey,
      path: paramsSvPath,
      parent: { kind: "ref-recipe", refKey: paramsTplRefKey },
      templateOf: paramsTplRefKey,
      name: "__Standard Values",
      fields: paramsSvFieldEntries,
    } satisfies CreateItemOp);

    operations.push({
      op: "SetStandardValues",
      policy,
      label: `link-params-standard-values:${recipe.handle}`,
      templateRefKey: paramsTplRefKey,
      standardValuesRefKey: paramsSvRefKey,
    } satisfies SetStandardValuesOp);
  }
}

function emitRendering(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  hasParams: boolean,
  policy: PushPolicy
): void {
  const site = siteOf(context);
  const renderingRefKey = renderingId(site, recipe.handle);
  const renderingParentPath = resolveRenderingParent(context, recipe.section);
  const renderingPath = joinPath(renderingParentPath, recipe.name);
  // Datasource template ref: prefer the explicit `datasource:` ref when
  // present (separate ContentTemplateRecipe under Content Models/);
  // otherwise the component template itself is the datasource template
  // (legacy inline-fields pattern).
  const datasourceRefKey = recipe.datasource
    ? templateId(site, recipe.datasource.handle)
    : templateId(site, recipe.handle);

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
    // refKey is `paramsTemplateId(site, recipe.handle)`).
    const paramsRefKey = recipe.parameters
      ? paramsTemplateId(site, recipe.parameters.handle)
      : paramsTemplateId(site, recipe.handle);
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

/**
 * Emit ops to materialise SXA Headless rendering variants for a
 * component-template recipe.
 *
 * Pre-2026 layout (DEPRECATED): variants lived at
 * `<rendering>/Variants/<Variant>` under generic `Folder` items. SXA
 * Headless doesn't recognise that location — the editor treats those
 * items as plain folders, not rendering variants, and the Pages
 * editor's "Variant" picker doesn't see them.
 *
 * Current layout (verified against live tenant 2026-05-02):
 *
 *   <headlessVariantsRoot>/
 *     └── <section>/                              ← HeadlessVariantsGrouping
 *         └── <RenderingName>/                    ← HeadlessVariants
 *             ├── default                          ← Variant Definition
 *             ├── outline                          ← Variant Definition
 *             └── …
 *
 * Recipes without `section` land directly at
 * `<headlessVariantsRoot>/<RenderingName>/<Variant>`.
 *
 * `headlessVariantsRoot` is required when any recipe declares variants
 * — without it the compiler throws INPUT_INVALID before emitting any
 * variant op. The orchestrator's ephemeral-cli-config sets this from
 * `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants`.
 */
function emitVariants(
  operations: Operation[],
  recipe: ComponentTemplateRecipe,
  context: CompileContext,
  icon: string,
  policy: PushPolicy,
  emittedFolders: Set<string>
): void {
  if (!context.headlessVariantsRoot) {
    throw createCliError(
      `Recipe '${recipe.handle}' declares ${recipe.variants.length} variants but no headlessVariantsRoot is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `headlessVariantsRoot` on the active envProfile in sitecoreai.cli.json (e.g. `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants`).",
      }
    );
  }
  const root = context.headlessVariantsRoot;
  const site = siteOf(context);

  // Section grouping under the Headless Variants root. Idempotent —
  // multiple recipes sharing the same section emit one folder. Distinct
  // dedup key from the templates-side / renderings-side section folders
  // (different tree, different identity).
  let perRenderingParentPath: string;
  let perRenderingParentRef: CreateItemOp["parent"];
  if (recipe.section) {
    const sectionRefKey = headlessVariantsSectionFolderId(site, recipe.section);
    const sectionPath = joinPath(root, recipe.section);
    if (!emittedFolders.has(sectionRefKey)) {
      emittedFolders.add(sectionRefKey);
      operations.push({
        op: "CreateItem",
        policy: "CreateOnly",
        label: `headless-variants-section-folder:${site}:${recipe.section}`,
        id: sectionRefKey,
        path: sectionPath,
        parent: { kind: "ref-path", value: root },
        templateOf: SITECORE_TEMPLATES.HEADLESS_VARIANTS_GROUPING,
        name: recipe.section,
        fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
      } satisfies CreateItemOp);
    }
    perRenderingParentPath = sectionPath;
    perRenderingParentRef = { kind: "ref-recipe", refKey: sectionRefKey };
  } else {
    perRenderingParentPath = root;
    perRenderingParentRef = { kind: "ref-path", value: root };
  }

  // Per-rendering grouping — one folder per recipe under the section
  // (or under the root, when section-less). Always unique per recipe;
  // no cross-recipe dedup needed.
  const folderRefKey = variantsFolderId(site, recipe.handle);
  const folderPath = joinPath(perRenderingParentPath, recipe.name);
  operations.push({
    op: "CreateItem",
    policy,
    label: `variants-folder:${recipe.handle}`,
    id: folderRefKey,
    path: folderPath,
    parent: perRenderingParentRef,
    templateOf: SITECORE_TEMPLATES.HEADLESS_VARIANTS,
    name: recipe.name,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);

  for (const variant of recipe.variants) {
    operations.push({
      op: "CreateItem",
      policy,
      label: `variant:${recipe.handle}/${variant.name}`,
      id: variantId(site, recipe.handle, variant.name),
      path: joinPath(folderPath, variant.name),
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: SITECORE_TEMPLATES.VARIANT_DEFINITION,
      name: variant.name,
      fields: [versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: variant.name })],
    } satisfies CreateItemOp);
  }
}
