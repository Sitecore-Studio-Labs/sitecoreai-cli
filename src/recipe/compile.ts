import {
  fieldId,
  paramsFieldId,
  paramsSectionId,
  paramsTemplateId,
  renderingId,
  sectionId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "./guids";
import {
  type CreateItemOp,
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
import { defaultPolicyForRecipe } from "./policy";
import {
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "./ir/sitecore-templates";
import {
  type ComponentTemplateRecipe,
  ComponentTemplateRecipeSchema,
  type ContentTemplateRecipe,
  ContentTemplateRecipeSchema,
  type FieldDefinition,
  type ParamDefinition,
  type Recipe,
  RecipeSchema,
} from "./schema/recipe";
import {
  defaultSitecoreFieldType,
  type SitecoreFieldType,
  sitecoreFieldTypeLabel,
} from "./schema/field-types";
import { renderSourceFields, sourceFieldsNeedHandleResolution } from "./schema/source-fields";

/**
 * Where a recipe's items land in the Sitecore content tree. Tenant-side
 * config — recipes themselves are tenant-agnostic. The compiler emits
 * deterministic Sitecore paths (`<templatesRoot>/<recipe.name>`, etc.)
 * that the executor resolves to server-assigned itemIds at runtime.
 */
export interface CompileContext {
  /** e.g. `/sitecore/templates/Project/<site>/Components`. */
  templatesRoot: string;
  /** e.g. `/sitecore/layout/Renderings/Project/<site>`. */
  renderingsRoot: string;
}

const PARAMS_SECTION_NAME = "Parameters";
const DEFAULT_FIELDS_SECTION = "Content";
const VARIANTS_FOLDER_NAME = "Variants";

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

/**
 * Compile a `ComponentTemplateRecipe` to an Operation IR.
 *
 * Pure: same recipe + same context → identical IR forever. The Authoring
 * API server-assigns itemIds on `createItem`, so the IR carries Sitecore
 * `path` fields for lookups + recipe-internal `refKey` GUIDs (uuidv5)
 * which the executor uses as the key into a per-run captured-itemId map.
 *
 * Op order is fixed so the IR is reviewable:
 *
 *   datasource template
 *     1. CreateItem(template)                    parent=templatesRoot path
 *     2. SetBaseTemplates(template) → Standard Template
 *     3. CreateItem(section)                     parent=template (ref-recipe)
 *     4. CreateItem(field)                       parent=section
 *     5. CreateItem(__Standard Values)           parent=template; templateOf=template's id
 *     6. SetStandardValues(template, sv)
 *
 *   parameters template (only when recipe.params is non-empty)
 *     7. CreateItem(params-template)
 *     8. SetBaseTemplates(params-template)
 *     9. CreateItem(params-section)
 *    10. CreateItem(params-field)
 *
 *   rendering and SXA Rendering Variants
 *    11. CreateItem(rendering)                   carries Parameters Template ref-recipe
 *    12. CreateItem(variants-folder)             only when recipe.variants is non-empty
 *    13. CreateItem(variant)
 */
export function compileComponentTemplateRecipe(
  input: ComponentTemplateRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ComponentTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const icon = DEFAULT_ICON;

  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
    },
    context,
    icon,
    policy
  );

  const hasParams = recipe.params.length > 0;
  if (hasParams) {
    emitParamsTemplate(operations, recipe, context, icon, policy);
  }

  emitRendering(operations, recipe, context, icon, hasParams, policy);

  if (recipe.variants.length > 0) {
    emitVariants(operations, recipe, context, icon, policy);
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Compile a `ContentTemplateRecipe` to an Operation IR.
 *
 * Content templates are data-only: a Sitecore template + sections + fields
 * + standard values + back-fill. No rendering, no params, no variants.
 */
export function compileContentTemplateRecipe(
  input: ContentTemplateRecipe,
  context: CompileContext
): OperationIr {
  const recipe = ContentTemplateRecipeSchema.parse(input);
  const operations: Operation[] = [];

  emitDatasourceTemplate(
    operations,
    {
      handle: recipe.handle,
      name: recipe.name,
      displayName: recipe.displayName,
      fields: recipe.fields,
      insertOptions: recipe.insertOptions,
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

/** Front-door dispatcher — accepts any registered recipe kind. */
export function compileRecipe(input: Recipe, context: CompileContext): OperationIr {
  const recipe = RecipeSchema.parse(input);
  switch (recipe.kind) {
    case "component-template":
      return compileComponentTemplateRecipe(recipe, context);
    case "content-template":
      return compileContentTemplateRecipe(recipe, context);
    case "content-item":
      throw new Error(
        `ContentItemRecipe compilation is not yet implemented (lands in Phase 4 alongside the field-value encoders). Recipe handle: ${recipe.handle}`
      );
  }
}

interface DatasourceTemplateInput {
  handle: string;
  name: string;
  displayName: string;
  fields: FieldDefinition[];
  insertOptions?: string[];
}

function emitDatasourceTemplate(
  operations: Operation[],
  recipe: DatasourceTemplateInput,
  context: CompileContext,
  icon: string,
  policy: PushPolicy
): void {
  const tplRefKey = templateId(recipe.handle);
  const tplPath = joinPath(context.templatesRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `template:${recipe.handle}`,
    id: tplRefKey,
    path: tplPath,
    parent: { kind: "ref-path", value: context.templatesRoot },
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
  policy: PushPolicy
): void {
  const paramsTplRefKey = paramsTemplateId(recipe.handle);
  const paramsName = `${recipe.name} Parameters`;
  const paramsDisplayName = `${recipe.displayName} Parameters`;
  const paramsTplPath = joinPath(context.templatesRoot, paramsName);

  operations.push({
    op: "CreateItem",
    policy,
    label: `params-template:${recipe.handle}`,
    id: paramsTplRefKey,
    path: paramsTplPath,
    parent: { kind: "ref-path", value: context.templatesRoot },
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
  const renderingPath = joinPath(context.renderingsRoot, recipe.name);
  const tplRefKey = templateId(recipe.handle);

  const fields: FieldValue[] = [
    sharedField(RENDERING_FIELDS.COMPONENT_NAME, { kind: "string", value: recipe.name }),
    sharedField(RENDERING_FIELDS.DATASOURCE_TEMPLATE, {
      kind: "ref-recipe",
      refKey: tplRefKey,
    }),
    sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: icon }),
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
  ];

  if (hasParams) {
    fields.push(
      sharedField(RENDERING_FIELDS.PARAMETERS_TEMPLATE, {
        kind: "ref-recipe",
        refKey: paramsTemplateId(recipe.handle),
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
    parent: { kind: "ref-path", value: context.renderingsRoot },
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
  const renderingPath = joinPath(context.renderingsRoot, recipe.name);
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
