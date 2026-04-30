/**
 * Public recipe API — `import { ... } from "@sitecoreai-demo/sitecoreai-deploy-and-sync/recipe"`.
 *
 * The registry (and any other consumer) imports recipe types and the
 * compiler from this entry. Internal CLI plumbing (config loading,
 * commander wiring, GraphQL transport bound to scai's environment shape)
 * stays in `src/recipe/{tasks,api/graphql,api/authoring-client,io}.ts`
 * and is NOT re-exported here.
 *
 * Stability contract: the surface in this file is the public contract.
 * Anything not exported here is internal and may move between scai
 * versions without notice.
 */

// Recipe author surface ---------------------------------------------------
export {
  ComponentPlacementSchema,
  ComponentTemplateRecipeSchema,
  ContentFieldValueSchema,
  ContentItemRecipeSchema,
  ContentTemplateRecipeSchema,
  FieldDefinitionSchema,
  LayoutSchema,
  PageDesignRecipeSchema,
  ParamDefinitionSchema,
  PartialDesignRecipeSchema,
  PlaceholderDefinitionSchema,
  RecipeSchema,
  RenderingDefinitionSchema,
  RenderingVariantDefinitionSchema,
  SitecoreFieldAugmentSchema,
  type ComponentPlacement,
  type ComponentTemplateRecipe,
  type ContentFieldValue,
  type ContentItemRecipe,
  type ContentTemplateRecipe,
  type FieldDefinition,
  type Layout,
  type PageDesignRecipe,
  type ParamDefinition,
  type PartialDesignRecipe,
  type PlaceholderDefinition,
  type Recipe,
  type RenderingDefinition,
  type RenderingVariantDefinition,
  type SitecoreFieldAugment,
} from "./schema/recipe";

export {
  FIELD_SHAPES,
  FieldShapeSchema,
  SITECORE_FIELD_TYPES,
  SitecoreFieldTypeSchema,
  defaultSitecoreFieldType,
  sitecoreFieldTypeLabel,
  type FieldShape,
  type SitecoreFieldType,
} from "./schema/field-types";

// Compiler ----------------------------------------------------------------
export {
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  compilePageDesignRecipe,
  compilePartialDesignRecipe,
  compileRecipe,
  type CompileContext,
} from "./compile";

export { emitLayoutXml } from "./layout/emit";
export type { ComponentPlacementInput, LayoutEmitContext, LayoutInput } from "./layout/emit";

export { encodeTemplatesMapping, type TemplatesMappingEntry } from "./layout/templates-mapping";

// GUID derivation ---------------------------------------------------------
export {
  NAMESPACE_CONTENT_ITEM,
  NAMESPACE_PAGE_DESIGN,
  NAMESPACE_PARTIAL_DESIGN,
  NAMESPACE_RENDERING,
  NAMESPACE_ROOT,
  NAMESPACE_SITE_BRANCH,
  NAMESPACE_TEMPLATE,
  PAGE_DESIGNS_ROOT_REF_KEY,
  contentItemId,
  datasourceId,
  fieldId,
  pageDesignId,
  paramsFieldId,
  paramsSectionId,
  paramsTemplateId,
  partialDesignId,
  renderingId,
  sectionId,
  siteBranchId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "./guids";

// Operation IR ------------------------------------------------------------
export {
  CreateItemOpSchema,
  FieldValueSchema,
  OperationIrSchema,
  OperationSchema,
  PushPolicySchema,
  RefValueSchema,
  SetBaseTemplatesOpSchema,
  SetFieldOpSchema,
  SetStandardValuesOpSchema,
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  type PushPolicy,
  type RefValue,
  type SetBaseTemplatesOp,
  type SetFieldOp,
  type SetStandardValuesOp,
} from "./ir/operations";

export {
  COMPOSITION_FIELDS,
  DEFAULT_DEVICE_ID,
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  LAYOUT_FIELDS,
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "./ir/sitecore-templates";

// Planner / executor ------------------------------------------------------
export { buildPlan } from "./plan";
export type {
  FieldDiffEntry,
  Plan,
  PlanEvent,
  PlanOptions,
  PlanSummary,
  PlannedAction,
} from "./plan";

export { executeIr } from "./execute";
export type { ExecuteOptions, ExecutionEvent, ExecutionMode, ExecutionResult } from "./execute";

// Authoring API client seam (interface only — bring your own implementation)
export type {
  AuthoringApiClient,
  CreateItemInput,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "./api/client";

// Reference encoding (RefValue → canonical Sitecore string) -------------
export { renderRefValue } from "./api/ref-encoding";

// Source fields (recipe `sitecore.sourceTypes/Query/Scope/Raw`) ---------
export {
  renderSourceFields,
  sourceFieldsNeedHandleResolution,
  type SourceFields,
} from "./schema/source-fields";

// Policy assignment (Phase 3+ extension point) --------------------------
export {
  defaultPolicyForRecipe,
  policyFor,
  policyForOp,
  purposeForRecipe,
  type OpPurpose,
} from "./policy";
