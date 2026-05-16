/**
 * Public recipe API — `import { ... } from "@sitecoreai-labs/sitecoreai-cli/recipe"`.
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
  PageRecipeSchema,
  PageTemplateRecipeSchema,
  DesignParameterSchema,
  DesignParametersTemplateRecipeSchema,
  PartialDesignRecipeSchema,
  PlaceholderDefinitionSchema,
  PlaceholderRecipeSchema,
  RecipeMetaSchema,
  RecipeSchema,
  RecipeDatasourceSchema,
  RenderingDatasourceLocationSchema,
  RenderingVariantDefinitionSchema,
  SectionDefinitionRecipeSchema,
  SiteGroupingSchema,
  SiteRecipeSchema,
  SiteTemplateDictionaryEntrySchema,
  SiteTemplateRecipeSchema,
  SiteTemplateTaxonomyEntrySchema,
  SitecoreFieldAugmentSchema,
  type ComponentPlacement,
  type ComponentTemplateRecipe,
  type ContentFieldValue,
  type ContentItemRecipe,
  type ContentTemplateRecipe,
  type FieldDefinition,
  type Layout,
  type PageDesignRecipe,
  type PageRecipe,
  type PageTemplateRecipe,
  type DesignParameter,
  type DesignParametersTemplateRecipe,
  type PartialDesignRecipe,
  type PlaceholderDefinition,
  type PlaceholderRecipe,
  type Recipe,
  type RecipeMeta,
  type RecipeDatasource,
  type RenderingDatasourceLocation,
  type RenderingVariantDefinition,
  type SectionDefinitionRecipe,
  type SiteGrouping,
  type SiteRecipe,
  type SiteTemplateDictionaryEntry,
  type SiteTemplateRecipe,
  type SiteTemplateTaxonomyEntry,
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
  compileContentItemRecipe,
  compileContentTemplateRecipe,
  compilePageDesignRecipe,
  compilePageTemplateRecipe,
  compilePageRecipe,
  compilePlaceholderRecipe,
  compileDesignParametersTemplateRecipe,
  compilePartialDesignRecipe,
  compileRecipe,
  compileRecipeSet,
  compileSectionDefinitionRecipe,
  compileSiteRecipe,
  compileSiteTemplateRecipe,
  PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE,
  TEMPLATES_MAPPING_AGGREGATE_HANDLE,
  type CompileContext,
} from "./compile";

export { emitLayoutXml } from "./layout/emit";
export type { ComponentPlacementInput, LayoutEmitContext, LayoutInput } from "./layout/emit";

export { encodeTemplatesMapping, type TemplatesMappingEntry } from "./layout/templates-mapping";

// GUID derivation ---------------------------------------------------------
export {
  NAMESPACE_CONTENT_ITEM,
  NAMESPACE_PAGE,
  NAMESPACE_PAGE_DESIGN,
  NAMESPACE_PARTIAL_DESIGN,
  NAMESPACE_PLACEHOLDER,
  NAMESPACE_PROJECT,
  NAMESPACE_RENDERING,
  NAMESPACE_ROOT,
  NAMESPACE_SECTION_DEFINITION,
  NAMESPACE_SITE_BRANCH,
  NAMESPACE_TEMPLATE,
  PAGE_DESIGNS_ROOT_REF_KEY,
  componentFolderStandardValuesId,
  componentFolderTemplateId,
  componentFoldersBucketId,
  contentItemId,
  contentModelsGroupFolderId,
  datasourceId,
  fieldId,
  pageDesignId,
  pageItemId,
  pageTemplatesGroupFolderId,
  placeholderSettingsId,
  designParameterFieldId,
  designParametersSectionId,
  designParametersTemplateId,
  partialDesignId,
  presentationDesignParametersBucketId,
  renderingId,
  renderingsSectionFolderId,
  sectionDefinitionId,
  sectionFolderId,
  sectionId,
  siteBranchId,
  siteDataFolderId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "./guids";

// Operation IR ------------------------------------------------------------
export {
  AppendToMultiListOpSchema,
  CreateItemOpSchema,
  FieldValueSchema,
  OperationIrSchema,
  OperationSchema,
  PushPolicySchema,
  RefValueSchema,
  SetBaseTemplatesOpSchema,
  SetFieldOpSchema,
  SetStandardValuesOpSchema,
  type AppendToMultiListOp,
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
  SECTION_DEFINITION_FIELDS,
  SITE_FIELDS,
  SITE_TEMPLATE_FIELDS,
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

// Authoring API client seam (interface — bring your own implementation,
// OR use `createAuthoringClient` below for scai's production client).
export type {
  AuthoringApiClient,
  CreateItemInput,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "./api/client";

// Production AuthoringApiClient factory. Library callers use this when
// they want scai's implementation (path resolution, parent-folder
// auto-creation, retry-on-throttle for read GETs) without re-implementing
// the wire-protocol semantics from scratch.
export { createAuthoringClient, type AuthoringClientOptions } from "./api/authoring-client";

// Authoring GraphQL transport. `runAuthoringGraphQL` is the escape hatch
// for ad-hoc queries scai's typed clients don't cover; it shares retry +
// timeout + auth + redaction with `createAuthoringClient`.
export { runAuthoringGraphQL, type AuthoringRequestOptions } from "./api/graphql";

// Sites API client seam + factory + types. Parallels the Authoring
// client pair: the interface is what the recipe planner depends on,
// `createSitesApiClient` is the production adapter over the Sites HTTP
// API, and the re-exported types describe the values flowing across.
export {
  createSitesApiClient,
  type SitesApiClient,
  type Job,
  type JobResponse,
  type Language,
  type NewSiteInput,
  type Site,
  type SiteCollection,
  type SiteTemplate,
} from "./api/sites-client";

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

// Cross-recipe validation -----------------------------------------------
export {
  formatValidationErrors,
  isValid,
  validateRecipeSet,
  validateRecipeSetOrThrow,
  type CyclicReference,
  type DuplicateHandle,
  type FieldShapeError,
  type PlacementViolation,
  type RecipeKind,
  type UnresolvedHandle,
  type ValidationResult,
} from "./validate";
