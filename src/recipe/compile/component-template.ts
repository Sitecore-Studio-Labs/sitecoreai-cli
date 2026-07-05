import {
  componentFolderStandardValuesId,
  componentFolderTemplateId,
  designParameterFieldId,
  designParametersSectionId,
  designParametersStandardValuesId,
  designParametersTemplateId,
  placeholderSettingsId,
  renderingId,
  sharedDataFolderTemplateId,
  siteDataFolderId,
  siteDataFolderStandardValuesId,
  siteDataFolderStandardValuesIdForLocation,
  siteDataFolderTemplateId,
  siteDataFolderTemplateIdForLocation,
  templateId,
  variantId,
  variantsFolderId,
} from "../items/guids";
import {
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
import { defaultPolicyForRecipe } from "../runtime/policy";
import { createScaiError } from "../../shared/errors";
import {
  DEFAULT_ICON,
  IDYNAMIC_PLACEHOLDER_TEMPLATE_ID,
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SXA_COMPONENT_BASE_TEMPLATES,
  SXA_HEADLESS_PARAMS_BASE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import {
  type ComponentTemplateRecipe,
  type ComponentTemplateRecipeParsed,
  ComponentTemplateRecipeSchema,
} from "../schema/recipe";
import { resolveSectionRecipe } from "./component-section";
import {
  PARAMS_SECTION_NAME,
  PARAMS_SORT_ORDER_BASE,
  buildFieldOp,
  buildStandardValuesFieldEntries,
  datasourceTemplateHandles,
  emitDatasourceTemplate,
  ensureComponentFoldersBucket,
  ensurePresentationDesignParametersBucket,
  ensureRenderingsSectionFolder,
  ensureSectionFolder,
  joinPath,
  resolveComponentFoldersBucketPath,
  resolveComponentTemplateParent,
  resolvePresentationDesignParametersBucketPath,
  resolveRenderingParent,
  sharedField,
  siteOf,
  versionedField,
  type CompileContext,
} from "./shared";

/**
 * Resolve `recipe.section?.handle` to the section's `name` via the
 * cross-recipe `sectionsByHandle` map on `CompileContext`. Returns
 * `undefined` when the recipe has no section (legacy flat layout);
 * throws INPUT_INVALID when the recipe references a section handle
 * that no `ComponentSectionRecipe` in the set provides.
 */
const resolveSectionName = (
  recipe: ComponentTemplateRecipeParsed,
  context: CompileContext
): string | undefined => {
  if (!recipe.section) return undefined;
  return resolveSectionRecipe(recipe.handle, recipe.section.handle, context.sectionsByHandle).name;
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

  // `dynamicPlaceholders: true` chains `_IDynamicPlaceholder` onto the
  // params template's base templates. That mutation belongs to the
  // per-recipe synthesised params template — it must not be applied to
  // a shared external template (other consumers may not need it).
  // Validator rejects this combination upstream; assert defensively in
  // case a non-validator call site reaches here.
  if (recipe.parameters && recipe.dynamicPlaceholders) {
    throw createScaiError(
      `Recipe '${recipe.handle}' combines an external 'parameters' template with 'dynamicPlaceholders: true'.`,
      "INPUT_INVALID",
      {
        hint: "Inline the params via 'params:' (the IDynamicPlaceholder base chains onto the synthesised per-recipe template) or drop 'dynamicPlaceholders' from the consumer.",
      }
    );
  }

  const sectionName = resolveSectionName(recipe, context);
  if (sectionName) {
    ensureSectionFolder(operations, context, sectionName, emittedFolders);
  }

  // Pure-layout renderings (Container, ColumnSplitter, RowSplitter,
  // SectionWrapper, …) declare no `fields:` and no `insertOptions`.
  // They have no datasource — authors don't bind content to them, they
  // just expose placeholders for children. Match the XM Cloud starter
  // pattern by NOT emitting a phantom empty data template item for
  // these. The rendering's `Datasource Template` shared field is
  // already omitted for the same case (see below), so the template
  // would be orphaned anyway. Skipping the emission keeps the
  // templates tree honest — only renderings that need a datasource
  // get one.
  const hasInlineFields = (recipe.fields?.length ?? 0) > 0;
  const hasInsertOptions = (recipe.insertOptions?.length ?? 0) > 0;
  const needsOwnDataTemplate = hasInlineFields || hasInsertOptions;
  if (needsOwnDataTemplate) {
    emitDatasourceTemplate(
      operations,
      {
        handle: recipe.handle,
        name: recipe.name,
        displayName: recipe.displayName,
        fields: recipe.fields,
        insertOptions: recipe.insertOptions,
        ...(recipe.mediaLocation ? { mediaLocation: recipe.mediaLocation } : {}),
        // Component templates always sit at the section root (or
        // templatesRoot, for legacy callers).
        parentPath: resolveComponentTemplateParent(context, sectionName),
        // SXA Foundation bases (`_PerSiteStandardValues`,
        // `_HorizonDatasourceGrouping`, `_PublishingGroupingTemplate`)
        // — verified against live tenants on 2026-05-02. Without
        // these the SXA editor doesn't recognise the item as a
        // component and fields/standard-values won't surface in the
        // Pages editor.
        additionalBaseTemplates: SXA_COMPONENT_BASE_TEMPLATES,
      },
      context,
      icon,
      policy
    );
  }

  if (recipe.children) {
    emitComponentFolderTemplate(operations, recipe, context, icon, emittedFolders);
  }

  // Emit the per-component Data Folder template once per recipe-handle
  // when at least one site-scoped datasource location declares a
  // subfolder. The folder ITEMs at `<contentItemsRoot>/<subfolder>`
  // (emitted later inside `emitRendering`) conform to this template so
  // their `__Standard Values`'s Insert Options restrict right-click →
  // Insert to this component's datasource type.
  const hasSiteScopedSubfolder = (recipe.datasource?.locations ?? []).some(
    (location) => location.scope === "site" && !!location.subfolder
  );
  if (hasSiteScopedSubfolder) {
    emitSiteDataFolderTemplate(operations, recipe, context, icon, emittedFolders);
  }

  // Parameter template emission:
  //   - If `recipe.parameters` is set, the rendering points at that
  //     external parameters template (no synthesis here).
  //   - Else if inline `params:` non-empty, synthesise an anonymous
  //     parameters template at the section-local Presentation
  //     Parameters bucket (or templatesRoot for legacy).
  const hasInlineParams = recipe.params.length > 0 && !recipe.parameters;
  if (hasInlineParams) {
    emitParamsTemplate({ operations, recipe, context, icon, policy, emittedFolders });
  }

  if (sectionName) {
    ensureRenderingsSectionFolder(operations, context, sectionName, emittedFolders);
  }

  emitRendering({
    operations,
    recipe,
    context,
    icon,
    hasParams: hasInlineParams || recipe.parameters !== undefined,
    policy,
    emittedFolders,
  });

  if (recipe.variants.length > 0) {
    emitVariants({ operations, recipe, context, icon, policy, emittedFolders });
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
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
  recipe: ComponentTemplateRecipeParsed,
  context: CompileContext,
  icon: string,
  emittedFolders: Set<string>
): void {
  const sectionName = resolveSectionName(recipe, context);
  if (!sectionName) {
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
    sectionName,
    emittedFolders
  );

  const folderName = `${recipe.name} Folder`;
  const folderTplRefKey = componentFolderTemplateId(site, recipe.handle);
  const folderTplPath = joinPath(
    resolveComponentFoldersBucketPath(context, sectionName),
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

/**
 * Emit the `<Component> Data Folder` template under
 * `Components/<section>/Component Folders/`. Co-located with the
 * `<Component> Folder` template emitted by
 * `emitComponentFolderTemplate` (different seed → distinct template
 * GUID; both share the same Component Folders bucket).
 *
 * The template's `__Standard Values` carries an Insert Options multi-
 * list referencing the recipe's own datasource template, so the
 * `<contentItemsRoot>/<subfolder>` folder ITEM(s) — which conform to
 * this template — restrict CMS authors' right-click → Insert UX to
 * inserting only the recipe's datasource items.
 *
 * Idempotent on the template's refKey via `emittedFolders`: a recipe
 * declaring multiple site-scoped subfolders emits this template once.
 *
 * Shared-subfolder interaction: when `context.sharedSubfolders` is set
 * and EVERY site-scoped subfolder declared by this recipe is in the
 * shared set, this function early-returns without emitting anything —
 * the cross-recipe coalescer in `compileRecipeSet` emits a single
 * SHARED template (`sharedDataFolderTemplateId(site, subfolder)`) with
 * the union of contributing recipes' Insert Options instead. A recipe
 * with a MIX of shared + singleton subfolders still emits its
 * per-recipe template (the singleton folder item needs it).
 */
function emitSiteDataFolderTemplate(
  operations: Operation[],
  recipe: ComponentTemplateRecipeParsed,
  context: CompileContext,
  icon: string,
  emittedFolders: Set<string>
): void {
  const sectionName = resolveSectionName(recipe, context);
  if (!sectionName) {
    // Without a section we can't pick a sensible parent folder; skip
    // emission and let the validator surface the missing section.
    return;
  }

  // Skip per-recipe template entirely when every site-scoped subfolder
  // this recipe targets has been promoted to the shared coalescer (≥2
  // recipes pointing at it). The coalescer-emitted shared template
  // owns Insert Options for those folders. Mixed cases (some shared,
  // some singleton) keep emitting — singleton folder items still
  // reference this per-recipe template via templateOf.
  const siteLocations = (recipe.datasource?.locations ?? []).filter(
    (l) => l.scope === "site" && !!l.subfolder
  );
  if (siteLocations.length === 0) return;
  const allShared =
    context.sharedSubfolders !== undefined &&
    siteLocations.every((l) => context.sharedSubfolders!.has(l.subfolder!));
  if (allShared) return;

  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);

  const bucketRefKey = ensureComponentFoldersBucket(
    operations,
    context,
    sectionName,
    emittedFolders
  );

  // Split site-locations into two groups:
  //   1. WITH allowedTemplates → emit a PER-LOCATION template + SV
  //      with that location's allow-list (one template per subfolder).
  //   2. WITHOUT allowedTemplates → fall through to the legacy
  //      per-recipe template (single template, Insert Options =
  //      recipe's own datasource template) — preserves existing
  //      consumers that haven't adopted allowedTemplates yet.
  const perLocationLocations = siteLocations.filter((l) => (l.allowedTemplates ?? []).length > 0);
  const legacyLocations = siteLocations.filter((l) => (l.allowedTemplates ?? []).length === 0);

  // -------- per-location templates (allowedTemplates set) --------
  for (const location of perLocationLocations) {
    const subfolder = location.subfolder as string;
    if (context.sharedSubfolders?.has(subfolder)) continue;

    const tplRefKey = siteDataFolderTemplateIdForLocation(site, recipe.handle, subfolder);
    if (emittedFolders.has(tplRefKey)) continue;
    emittedFolders.add(tplRefKey);

    // Per-location data-folder templates live FLAT in the recipe's
    // Component Folders bucket — they don't mirror the subfolder
    // hierarchy because they're TEMPLATES (not content). The full
    // subfolder still needs to appear in the name to disambiguate
    // when one recipe declares multiple subfolders (`a/x` vs `a/y`
    // would otherwise collide). Sitecore's InvalidItemNameChars
    // setting rejects `/` in item names, so collapse to ` - `
    // (preserves both segments for legibility). Display name keeps
    // the original `/` — only the item name and path segment are
    // restricted.
    const tplNameSubfolder = subfolder.replace(/\//g, " - ");
    const tplName = `${recipe.name} ${tplNameSubfolder} Data Folder`;
    const tplPath = joinPath(resolveComponentFoldersBucketPath(context, sectionName), tplName);

    operations.push({
      op: "CreateItem",
      policy,
      label: `site-data-folder-template:${recipe.handle}:${subfolder}`,
      id: tplRefKey,
      path: tplPath,
      parent: { kind: "ref-recipe", refKey: bucketRefKey },
      templateOf: SITECORE_TEMPLATES.TEMPLATE,
      name: tplName,
      fields: [
        sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
          kind: "string",
          value: `${recipe.displayName} ${subfolder} Data Folder`,
        }),
      ],
    } satisfies CreateItemOp);

    operations.push({
      op: "SetBaseTemplates",
      policy,
      label: `site-data-folder-base-templates:${recipe.handle}:${subfolder}`,
      itemRefKey: tplRefKey,
      baseTemplates: [STANDARD_TEMPLATE_ID],
    } satisfies SetBaseTemplatesOp);

    const svRefKey = siteDataFolderStandardValuesIdForLocation(site, recipe.handle, subfolder);
    const svPath = joinPath(tplPath, "__Standard Values");
    operations.push({
      op: "CreateItem",
      policy,
      label: `site-data-folder-standard-values:${recipe.handle}:${subfolder}`,
      id: svRefKey,
      path: svPath,
      parent: { kind: "ref-recipe", refKey: tplRefKey },
      templateOf: tplRefKey,
      name: "__Standard Values",
      fields: [],
    } satisfies CreateItemOp);

    operations.push({
      op: "SetStandardValues",
      policy,
      label: `link-site-data-folder-standard-values:${recipe.handle}:${subfolder}`,
      templateRefKey: tplRefKey,
      standardValuesRefKey: svRefKey,
    } satisfies SetStandardValuesOp);

    operations.push({
      op: "SetField",
      policy,
      label: `site-data-folder-insert-options:${recipe.handle}:${subfolder}`,
      itemRefKey: svRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: location.allowedTemplates!.map((t) => templateId(site, t.handle)),
      },
    } satisfies SetFieldOp);
  }

  // -------- legacy per-recipe template (no allowedTemplates) --------
  if (legacyLocations.length === 0) return;
  const folderTplRefKey = siteDataFolderTemplateId(site, recipe.handle);
  if (emittedFolders.has(folderTplRefKey)) return;
  emittedFolders.add(folderTplRefKey);

  const folderName = `${recipe.name} Data Folder`;
  const folderTplPath = joinPath(
    resolveComponentFoldersBucketPath(context, sectionName),
    folderName
  );

  operations.push({
    op: "CreateItem",
    policy,
    label: `site-data-folder-template:${recipe.handle}`,
    id: folderTplRefKey,
    path: folderTplPath,
    parent: { kind: "ref-recipe", refKey: bucketRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE,
    name: folderName,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
        kind: "string",
        value: `${recipe.displayName} Data Folder`,
      }),
    ],
  } satisfies CreateItemOp);

  operations.push({
    op: "SetBaseTemplates",
    policy,
    label: `site-data-folder-base-templates:${recipe.handle}`,
    itemRefKey: folderTplRefKey,
    baseTemplates: [STANDARD_TEMPLATE_ID],
  } satisfies SetBaseTemplatesOp);

  const svRefKey = siteDataFolderStandardValuesId(site, recipe.handle);
  const svPath = joinPath(folderTplPath, "__Standard Values");
  operations.push({
    op: "CreateItem",
    policy,
    label: `site-data-folder-standard-values:${recipe.handle}`,
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
    label: `link-site-data-folder-standard-values:${recipe.handle}`,
    templateRefKey: folderTplRefKey,
    standardValuesRefKey: svRefKey,
  } satisfies SetStandardValuesOp);

  operations.push({
    op: "SetField",
    policy,
    label: `site-data-folder-insert-options:${recipe.handle}`,
    itemRefKey: svRefKey,
    fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
    value: {
      kind: "ref-recipe-list",
      refKeys: datasourceTemplateHandles(recipe).map((handle) => templateId(site, handle)),
    },
  } satisfies SetFieldOp);
}

function emitParamsTemplate({
  operations,
  recipe,
  context,
  icon,
  policy,
  emittedFolders,
}: {
  operations: Operation[];
  recipe: ComponentTemplateRecipeParsed;
  context: CompileContext;
  icon: string;
  policy: PushPolicy;
  emittedFolders: Set<string>;
}): void {
  const site = siteOf(context);
  const paramsTplRefKey = designParametersTemplateId(site, recipe.handle);
  const paramsName = `${recipe.name} Parameters`;
  const paramsDisplayName = `${recipe.displayName} Parameters`;

  const sectionName = resolveSectionName(recipe, context);
  let paramsParent: CreateItemOp["parent"];
  let paramsParentPath: string;
  if (sectionName) {
    const bucketRefKey = ensurePresentationDesignParametersBucket(
      operations,
      context,
      sectionName,
      emittedFolders
    );
    paramsParent = { kind: "ref-recipe", refKey: bucketRefKey };
    paramsParentPath = resolvePresentationDesignParametersBucketPath(context, sectionName);
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
    //
    // When the recipe declares `dynamicPlaceholders: true`, also chain
    // SXA's `_IDynamicPlaceholder` interface template. That contributes
    // the `DynamicPlaceholderID` field that Pages writes per-placement
    // IDs to — both halves (this base AND the OtherProperties flag set
    // in `emitRendering`) are required for nested placeholders to
    // resolve end-to-end. Setting just one produces a silently-broken
    // shape where the container ships out childless.
    baseTemplates: [
      ...SXA_HEADLESS_PARAMS_BASE_TEMPLATES,
      ...(recipe.dynamicPlaceholders ? [IDYNAMIC_PLACEHOLDER_TEMPLATE_ID] : []),
    ],
  } satisfies SetBaseTemplatesOp);

  const paramsSecRefKey = designParametersSectionId(site, recipe.handle, PARAMS_SECTION_NAME);
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
        fieldRefKey: designParameterFieldId(site, recipe.handle, param.name),
        fieldPath: joinPath(paramsSecPath, param.name),
        parentRefKey: paramsSecRefKey,
        labelPrefix: `params-field:${recipe.handle}`,
        field: param,
        zeroBasedIndex: index,
        sortOrderBase: PARAMS_SORT_ORDER_BASE,
        policy,
        site,
        context,
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
    designParameterFieldId
  );
  if (paramsSvFieldEntries.length > 0) {
    const paramsSvRefKey = designParametersStandardValuesId(site, recipe.handle);
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

interface EmitRenderingOptions {
  operations: Operation[];
  recipe: ComponentTemplateRecipeParsed;
  context: CompileContext;
  icon: string;
  hasParams: boolean;
  policy: PushPolicy;
  emittedFolders: Set<string>;
}

function emitRendering({
  operations,
  recipe,
  context,
  icon,
  hasParams,
  policy,
  emittedFolders,
}: EmitRenderingOptions): void {
  const site = siteOf(context);
  const renderingRefKey = renderingId(site, recipe.handle);
  const sectionName = resolveSectionName(recipe, context);
  const renderingParentPath = resolveRenderingParent(context, sectionName);
  const renderingPath = joinPath(renderingParentPath, recipe.name);
  const datasourceField = resolveDatasourceTemplateField(recipe, site);

  const fields: FieldValue[] = [
    sharedField(RENDERING_FIELDS.COMPONENT_NAME, { kind: "string", value: recipe.name }),
    ...(datasourceField ? [datasourceField] : []),
    sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
  ];

  if (hasParams) {
    // Two cases for the rendering's `Parameters Template` field:
    //   1. `recipe.parameters: { handle }` — point at the external
    //      shared template.
    //   2. Inline `params:` — point at the synthesised inline template
    //      (its GUID is `designParametersTemplateId(site, recipe.handle)`).
    const paramsRefKey = recipe.parameters
      ? designParametersTemplateId(site, recipe.parameters.handle)
      : designParametersTemplateId(site, recipe.handle);
    fields.push(
      sharedField(RENDERING_FIELDS.PARAMETERS_TEMPLATE, {
        kind: "ref-recipe",
        refKey: paramsRefKey,
      })
    );
  }

  // Datasource: build the rendering's `Datasource Location` + `Open
  // Properties After Add` from the top-level `recipe.datasource` block.
  // Optional — a static rendering (no author-pickable datasource) omits
  // it; only `OtherProperties` (below) is unconditional.
  const ds = recipe.datasource;
  if (ds) {
    emitDatasourceLocationFields({ fields, operations, recipe, context, site, emittedFolders });
  }

  // OtherProperties is always emitted — `dynamicPlaceholders` and the
  // free-form `recipe.otherProperties` apply regardless of whether the
  // rendering has a datasource block.
  fields.push(
    sharedField(RENDERING_FIELDS.OTHER_PROPERTIES, {
      kind: "url-string-map",
      entries: buildOtherProperties(recipe),
    })
  );

  // Placeholders (plural) Treelist field on the SXA Headless rendering
  // chain — pipe-separated `{GUID}` refs, each pointing at one of the
  // Placeholder Settings items emitted alongside this push.
  //
  // SXA Headless reads each referenced settings item to recover the
  // slot's `Placeholder Key` (e.g. `container-{*}`) and emit a
  // `placeholders` map in the layout-service response. The starter-kit
  // Container / Column Splitter / Row Splitter all wire this field the
  // same way: pipe-joined GUIDs of the matching Placeholder Settings
  // items at `placeholderSettingsRoot`. Without it the layout service
  // ships no `placeholders` array for the rendering and the headless
  // SDK warns `Placeholder '<slot>-1' was not found in the current
  // rendering data`. Two earlier scai attempts wrote string keys to a
  // different field; the runtime ignores those — only this Treelist
  // wires the slots up.
  //
  // The Placeholder Settings items are emitted by
  // `buildPlaceholderSettingsAggregate` in compile.ts under the same
  // `(site, key)` namespace as `placeholderSettingsId(site, key)` here,
  // so the refKeys resolve to real itemIds by the time the executor
  // runs the SetField — no separate dependency wiring needed.
  if (recipe.placeholders?.length) {
    fields.push(
      sharedField(RENDERING_FIELDS.PLACEHOLDERS, {
        kind: "ref-recipe-list",
        refKeys: recipe.placeholders.map((slot) => placeholderSettingsId(site, slot.key)),
      })
    );
  }

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
 * Resolve the rendering's `Datasource Template` shared field. Four cases:
 *   1. Explicit `datasource.templates` array (≥1 handle) → multi-template
 *      "compatible-datasources" pattern (`ref-recipe-list`; the Pages
 *      picker surfaces items conforming to ANY listed template).
 *   2. Explicit `datasource.template` handle → the separate
 *      ContentTemplateRecipe (single compatible-data-source).
 *   3. Inline `fields:` (recipe has ≥1 field) → the component template IS
 *      the datasource template (legacy inline-fields pattern).
 *   4. Neither — a pure-layout rendering (Container, ColumnSplitter, …) →
 *      `undefined`, so the shared field stays empty. Sitecore Pages gates
 *      its "create or pick a datasource" prompt on this field being
 *      non-empty, so an empty value makes a layout-only rendering
 *      droppable without an authoring prompt.
 */
const resolveDatasourceTemplateField = (
  recipe: ComponentTemplateRecipeParsed,
  site: string
): FieldValue | undefined => {
  const datasourceTemplates = recipe.datasource?.templates;
  if (datasourceTemplates?.length) {
    return sharedField(RENDERING_FIELDS.DATASOURCE_TEMPLATE, {
      kind: "ref-recipe-list",
      refKeys: datasourceTemplates.map((t) => templateId(site, t.handle)),
    });
  }
  if (recipe.datasource?.template) {
    return sharedField(RENDERING_FIELDS.DATASOURCE_TEMPLATE, {
      kind: "ref-recipe",
      refKey: templateId(site, recipe.datasource.template.handle),
    });
  }
  if ((recipe.fields?.length ?? 0) > 0) {
    return sharedField(RENDERING_FIELDS.DATASOURCE_TEMPLATE, {
      kind: "ref-recipe",
      refKey: templateId(site, recipe.handle),
    });
  }
  return undefined;
};

/**
 * Assemble the rendering's `OtherProperties` map. `dynamicPlaceholders`
 * and the free-form `recipe.otherProperties` apply regardless of whether
 * the rendering has a datasource block; authors' explicit keys override
 * the auto-set values.
 */
const buildOtherProperties = (recipe: ComponentTemplateRecipeParsed): Record<string, string> => {
  const otherProperties: Record<string, string> = {};
  if (recipe.datasource?.autoCreate) otherProperties.IsAutoDatasourceRendering = "true";
  if (recipe.dynamicPlaceholders) {
    otherProperties.IsRenderingsWithDynamicPlaceholders = "true";
    // Tells SXA's layout-service serialiser that children inside this
    // rendering's dynamic placeholders inherit the rendering's datasource
    // as their context (child relative-datasource resolution). Pairs with
    // the IDynamicPlaceholder base template + the Placeholders shared
    // field — all three are required halves of the dynamic-placeholder
    // chain on XM Cloud / SXA Headless starter renderings.
    otherProperties.UsePlaceholderDatasourceContext = "true";
  }
  Object.assign(otherProperties, recipe.otherProperties ?? {});
  return otherProperties;
};

interface DatasourceLocationOptions {
  fields: FieldValue[];
  operations: Operation[];
  recipe: ComponentTemplateRecipeParsed;
  context: CompileContext;
  site: string;
  emittedFolders: Set<string>;
}

/** A single entry in a component-template recipe's `datasource.locations`. */
type DatasourceLocation = NonNullable<
  ComponentTemplateRecipeParsed["datasource"]
>["locations"][number];

/**
 * Emit a CreateOnly folder item for a site-scoped `(base, subfolder)`
 * datasource pool, deduped across recipes via `emittedFolders`.
 * Multi-segment subfolders (`ui/badges`) emit only the LEAF folder
 * explicitly — the executor's path-walker auto-creates the intermediate
 * segments.
 */
const emitSiteSubfolderPool = (
  opts: DatasourceLocationOptions,
  base: string,
  subfolder: string,
  allowedTemplates: readonly unknown[] | undefined
): void => {
  const { recipe, context, site, emittedFolders, operations } = opts;
  const folderRefKey = siteDataFolderId(site, subfolder);
  if (emittedFolders.has(folderRefKey)) return;
  emittedFolders.add(folderRefKey);

  const subfolderSegments = subfolder
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (subfolderSegments.length === 0) {
    throw createScaiError(
      `Recipe '${recipe.handle}' declares a site-scoped datasource subfolder that is empty after trimming.`,
      "INPUT_INVALID",
      { hint: "Use a non-empty subfolder string like 'Badges' or 'ui/badges'." }
    );
  }
  const leafName = subfolderSegments[subfolderSegments.length - 1];
  const intermediateSegments = subfolderSegments.slice(0, -1);
  const parentPath =
    intermediateSegments.length > 0 ? joinPath(base, intermediateSegments.join("/")) : base;
  const folderPath = joinPath(base, subfolderSegments.join("/"));
  // Template selection per subfolder:
  //   1. Shared-subfolder coalescer (≥2 recipes target same subfolder) →
  //      SHARED template (Insert Options = union of contributors).
  //   2. Singleton WITH allowedTemplates → per-LOCATION template.
  //   3. Singleton WITHOUT allowedTemplates → legacy per-recipe template.
  const isShared = context.sharedSubfolders?.has(subfolder) === true;
  const folderTemplateOf = isShared
    ? sharedDataFolderTemplateId(site, subfolder)
    : (allowedTemplates ?? []).length > 0
      ? siteDataFolderTemplateIdForLocation(site, recipe.handle, subfolder)
      : siteDataFolderTemplateId(site, recipe.handle);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `site-data-folder:${site}:${subfolder}`,
    id: folderRefKey,
    path: folderPath,
    parent: { kind: "ref-path", value: parentPath },
    // Conform to the per-component Data Folder template so the SV's Insert
    // Options restrict right-click → Insert to this recipe's own
    // datasource template. For multi-segment subfolders only the LEAF
    // folder gets this template; intermediates stay auto-created plain
    // folders via the executor's path-walker.
    templateOf: folderTemplateOf,
    name: leafName,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: "office/16x16/folder.png" }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: leafName }),
    ],
  } satisfies CreateItemOp);
};

/** Resolve one datasource location to its Source segment, emitting any site pool folder. */
const datasourceLocationSegment = (
  opts: DatasourceLocationOptions,
  location: DatasourceLocation
): string => {
  if (location.scope === "page") {
    return location.subfolder ? `./Data/${location.subfolder}` : "./Data";
  }
  // location.scope === "site"
  if (!opts.context.contentItemsRoot) {
    throw createScaiError(
      `Recipe '${opts.recipe.handle}' declares a site-scoped datasource location but no contentItemsRoot is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `contentItemsRoot` on the active envProfile in sitecoreai.cli.json (e.g. `/sitecore/content/<siteCollection>/<site>/Data`).",
      }
    );
  }
  const base = opts.context.contentItemsRoot;
  if (location.subfolder) {
    emitSiteSubfolderPool(opts, base, location.subfolder, location.allowedTemplates);
    return joinPath(base, location.subfolder);
  }
  return base;
};

/**
 * Emit the rendering's `Datasource Location` + `Open Properties After Add`
 * fields (and any site-scoped pool folders) from `recipe.datasource`.
 */
const emitDatasourceLocationFields = (opts: DatasourceLocationOptions): void => {
  const ds = opts.recipe.datasource!;
  const segments: string[] = [];
  for (const location of ds.locations) {
    segments.push(datasourceLocationSegment(opts, location));
  }
  // Raw query/source segments are appended verbatim — each is a complete
  // Sitecore Source segment (`query:$site/...`, `fast:/sitecore/...`).
  for (const raw of ds.query) segments.push(raw);

  opts.fields.push(
    sharedField(RENDERING_FIELDS.DATASOURCE_LOCATION, { kind: "string", value: segments.join("|") })
  );
  opts.fields.push(
    sharedField(RENDERING_FIELDS.OPEN_PROPERTIES_AFTER_ADD, {
      kind: "bool",
      value: ds.openPropertiesAfterAdd,
    })
  );
};

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
function emitVariants({
  operations,
  recipe,
  context,
  // `icon` is part of the emitter call contract (callers pass it for
  // symmetry with emitParamsTemplate) but variant items don't carry an
  // icon field — retained, unused, to keep the caller signature uniform.
  icon: _icon,
  policy,
  emittedFolders,
}: {
  operations: Operation[];
  recipe: ComponentTemplateRecipeParsed;
  context: CompileContext;
  icon: string;
  policy: PushPolicy;
  emittedFolders: Set<string>;
}): void {
  if (!context.headlessVariantsRoot) {
    throw createScaiError(
      `Recipe '${recipe.handle}' declares ${recipe.variants.length} variants but no headlessVariantsRoot is configured.`,
      "INPUT_INVALID",
      {
        hint: "Set `headlessVariantsRoot` on the active envProfile in sitecoreai.cli.json (e.g. `/sitecore/content/<siteCollection>/<site>/Presentation/Headless Variants`).",
      }
    );
  }
  const root = context.headlessVariantsRoot;
  const site = siteOf(context);

  // Per-rendering folder lives DIRECTLY under the Headless Variants
  // root — no section-grouping intermediate.
  //
  // SXA Headless Pages chrome walks exactly two levels under
  // `<site>/Presentation/Headless Variants`: <Rendering>/<Variant>.
  // Verified against a working tenant 2026-05-31: the chrome enumerates
  // variants by finding `HEADLESS_VARIANTS` items as DIRECT children
  // of the headless-variants root, then enumerates each one's
  // `VARIANT_DEFINITION` children. The recon found scai-pushed renderings
  // wrapped in an extra `HEADLESS_VARIANTS_GROUPING` section folder
  // (`root/ui/accordion-block/Default` vs the expected
  // `root/accordion-block/Default`); the chrome stopped at the
  // grouping folder and never saw the rendering's variants. Section
  // grouping IS correct on the templates + renderings trees (Sitecore
  // organises by section there) but the Headless Variants tree is flat.
  //
  // `_unusedEmittedFolders` retained so cross-recipe dedup interfaces
  // stay compatible with callers; section folders just don't go in.
  const _unusedEmittedFolders = emittedFolders;
  const perRenderingParentPath = root;
  const perRenderingParentRef: CreateItemOp["parent"] = {
    kind: "ref-path",
    value: root,
  };

  // Per-rendering folder under the headless variants root. Always
  // unique per recipe; no cross-recipe dedup needed.
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
    fields: [],
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
