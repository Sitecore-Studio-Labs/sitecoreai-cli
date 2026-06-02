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
 *
 * The recipe composition kinds (`ContentItem`, `PageDesign`, `PartialDesign`,
 * `SiteRecipe`, `SiteTemplate`) are NOT part of the 0.1.0 stability promise
 * and live on the separate `./recipe/unstable` entry (`src/recipe/unstable.ts`).
 */

// Recipe author surface ---------------------------------------------------
export {
  ComponentPlacementSchema,
  ComponentTemplateRecipeSchema,
  ContentFieldValueSchema,
  ContentTemplateRecipeSchema,
  FieldDefinitionSchema,
  LayoutSchema,
  PageRecipeSchema,
  PageTemplateRecipeSchema,
  DesignParameterSchema,
  DesignParametersTemplateRecipeSchema,
  PlaceholderDefinitionSchema,
  PlaceholderRecipeSchema,
  RecipeMetaSchema,
  RecipeSchema,
  RecipeDatasourceSchema,
  RenderingDatasourceLocationSchema,
  RenderingVariantDefinitionSchema,
  SitecoreFieldAugmentSchema,
  type ComponentPlacement,
  type ComponentTemplateRecipe,
  type ContentFieldValue,
  type ContentTemplateRecipe,
  type FieldDefinition,
  type Layout,
  type PageRecipe,
  type PageTemplateRecipe,
  type DesignParameter,
  type DesignParametersTemplateRecipe,
  type PlaceholderDefinition,
  type PlaceholderRecipe,
  type Recipe,
  type RecipeMeta,
  type RecipeDatasource,
  type RenderingDatasourceLocation,
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
// `compileRecipe` / `compileRecipeSet` dispatch across every kind including
// the composition kinds; the kind-specific composition compilers
// (`compilePageDesignRecipe`, …) live on `./recipe/unstable`.
export {
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  compilePageTemplateRecipe,
  compilePageRecipe,
  compilePlaceholderRecipe,
  compileDesignParametersTemplateRecipe,
  compileRecipe,
  compileRecipeSet,
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
  sectionFolderId,
  sectionId,
  siteBranchId,
  siteDataFolderId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "./items/guids";

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
  SITE_FIELDS,
  SITE_TEMPLATE_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "./ir/sitecore-templates";

// Planner / executor ------------------------------------------------------
export { buildPlan } from "./runtime/plan";
export type {
  FieldDiffEntry,
  Plan,
  PlanEvent,
  PlanOptions,
  PlanSummary,
  PlannedAction,
} from "./runtime/plan";

export { executeIr } from "./runtime/execute";
export type {
  ExecuteOptions,
  ExecutionEvent,
  ExecutionMode,
  ExecutionResult,
} from "./runtime/execute";

// Three-way merge baseline (0.3+) — the BaselineStorage interface lets
// remote backends (orchestrator-hosted, in-memory) plug in without
// changing push/pull entry points. FileBaselineStorage is the default
// (writes under <configDir>/.scai/baseline/). The schema types are
// exported so custom storage impls can validate + produce baselines
// shape-compatible with what scai's planner reads.
//
// Merge helpers (classifyMergeStatus, mergeContentValueRecipe, etc.)
// stay internal — the CLI is the public consumer of the merge logic;
// programmatic consumers reach for `buildPlan` + `executeIr` directly.
// See docs/bidirectional-sync.md for the operator walkthrough.
export {
  BaselineFieldEntrySchema,
  BaselineSchema,
  CONTENT_RECIPE_BASELINE_KIND,
  FileBaselineStorage,
  adaptSyncBaselineStorage,
  baselineFilePath,
  canonicaliseLayoutXml,
  hashFieldValue,
  hashFieldValueForBaseline,
  indexBaseline,
  isLayoutFieldId,
  loadBaseline,
  writeBaseline,
} from "./runtime/baseline";
export type {
  Baseline,
  BaselineFieldEntry,
  BaselineIndex,
  BaselineStorage,
} from "./runtime/baseline";

// Merge plan schema (0.3+) — the JSON document `scai recipe pull
// --write-plan` emits + `--apply-plan` consumes. Operators hand-edit
// this file to pick per-field winners; programmatic consumers can
// produce / validate via the exported Zod schemas.
export { MergePlanFieldSchema, MergePlanRecipeSchema, MergePlanSchema } from "./tasks/pull";
export type { MergePlan, MergePlanField, MergePlanRecipe } from "./tasks/pull";

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

// Policy assignment (extension point for kind-specific overrides) --------
export {
  defaultPolicyForRecipe,
  policyFor,
  policyForOp,
  purposeForRecipe,
  type OpPurpose,
} from "./runtime/policy";

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
