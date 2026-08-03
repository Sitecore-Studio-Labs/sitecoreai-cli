import { describe, expect, it } from "vitest";
import * as recipe from "../../../src/recipe";
import * as recipeSchema from "../../../src/recipe/schema";
import * as recipeUnstable from "../../../src/recipe/unstable";

/**
 * Pin the public-API surface exposed at `<scai>/recipe`. If a symbol
 * disappears or moves, this test fails — preventing accidental breaking
 * changes to consumers (the registry imports `ComponentTemplateRecipeSchema`
 * here; the orchestrator may import the compiler / planner / executor).
 *
 * When intentionally removing or renaming an export, update this list AND
 * note the breaking change in the changelog.
 */
describe("public recipe API surface", () => {
  const REQUIRED_EXPORTS = [
    // Recipe author surface (Site/SiteTemplate live on ./recipe/unstable;
    // the four graduated kinds are pinned separately below)
    "ComponentPlacementSchema",
    "ComponentTemplateRecipeSchema",
    "ContentFieldValueSchema",
    "ContentTemplateRecipeSchema",
    "FieldDefinitionSchema",
    "LayoutSchema",
    "DesignParameterSchema",
    "PlaceholderDefinitionSchema",
    "RecipeSchema",
    "RecipeDatasourceSchema",
    "RenderingDatasourceLocationSchema",
    "RenderingVariantDefinitionSchema",
    "SitecoreFieldAugmentSchema",
    // Field types / shapes
    "FIELD_SHAPES",
    "FieldShapeSchema",
    "SITECORE_FIELD_TYPES",
    "SitecoreFieldTypeSchema",
    "defaultSitecoreFieldType",
    "sitecoreFieldTypeLabel",
    // Compiler (only the Site/SiteTemplate compilers live on ./recipe/unstable)
    "compileComponentTemplateRecipe",
    "compileContentTemplateRecipe",
    "compileRecipe",
    "compileRecipeSet",
    "TEMPLATES_MAPPING_AGGREGATE_HANDLE",
    // Layout primitives
    "emitLayoutXml",
    "encodeTemplatesMapping",
    // GUID derivation (subset — the most-used ones)
    "templateId",
    "renderingId",
    "fieldId",
    "sectionId",
    "designParametersTemplateId",
    "variantId",
    "variantsFolderId",
    "contentItemId",
    "partialDesignId",
    "pageDesignId",
    "PAGE_DESIGNS_ROOT_REF_KEY",
    "NAMESPACE_ROOT",
    "NAMESPACE_CONTENT_ITEM",
    "NAMESPACE_PARTIAL_DESIGN",
    "NAMESPACE_PAGE_DESIGN",
    // Operation IR
    "OperationSchema",
    "OperationIrSchema",
    "RefValueSchema",
    "FieldValueSchema",
    "PushPolicySchema",
    "CreateItemOpSchema",
    "SetFieldOpSchema",
    "SetBaseTemplatesOpSchema",
    "SetStandardValuesOpSchema",
    // Sitecore template constants
    "SITECORE_TEMPLATES",
    "STANDARD_TEMPLATE_ID",
    "SYSTEM_FIELDS",
    "RENDERING_FIELDS",
    "TEMPLATE_FIELD_FIELDS",
    "LAYOUT_FIELDS",
    "COMPOSITION_FIELDS",
    "SITE_FIELDS",
    "SITE_TEMPLATE_FIELDS",
    "DEFAULT_ICON",
    "DEFAULT_DEVICE_ID",
    "DEFAULT_LANGUAGE",
    "DEFAULT_VERSION",
    // Planner / executor
    "buildPlan",
    "executeIr",
    // Reference encoding
    "renderRefValue",
    // Source fields
    "renderSourceFields",
    "sourceFieldsNeedHandleResolution",
    // Policy
    "defaultPolicyForRecipe",
    "policyFor",
    "policyForOp",
    "purposeForRecipe",
    // Cross-recipe validation
    "validateRecipeSet",
    "validateRecipeSetOrThrow",
    "isValid",
    "formatValidationErrors",
  ] as const;

  it.each(REQUIRED_EXPORTS)("exports %s", (name) => {
    expect((recipe as Record<string, unknown>)[name]).toBeDefined();
  });

  it("can validate a recipe end-to-end via the public surface", () => {
    const result = recipe.ComponentTemplateRecipeSchema.safeParse({
      kind: "component-template",
      schemaVersion: "1",
      handle: "smoke@1",
      name: "Smoke",
      displayName: "Smoke",
      fields: [{ name: "Title", shape: "text" }],
    });
    expect(result.success).toBe(true);
  });

  it("can compile a recipe via the public surface", () => {
    const ir = recipe.compileComponentTemplateRecipe(
      {
        kind: "component-template",
        schemaVersion: "1",
        handle: "smoke@1",
        name: "Smoke",
        displayName: "Smoke",
        fields: [{ name: "Title", shape: "text" }],
        variants: [],
        params: [],
      },
      {
        templatesRoot: "/sitecore/templates/Project/test/Components",
        renderingsRoot: "/sitecore/layout/Renderings/Project/test",
        headlessVariantsRoot: "/sitecore/content/test-tenant/test/Presentation/Headless Variants",
      }
    );
    expect(ir.schemaVersion).toBe("1");
    expect(ir.recipeHandle).toBe("smoke@1");
    expect(ir.operations.length).toBeGreaterThan(0);
  });
});

/**
 * The composition kinds are split across the two entries.
 *
 * Four graduated to stable `./recipe` — `ContentItem`, `PageDesign`,
 * `PartialDesign`, `Dictionary`. They stay re-exported from
 * `./recipe/unstable` through a deprecation window so the ~116 first-party
 * imports migrate lazily instead of in one commit, so they must resolve
 * from BOTH entries.
 *
 * Two stayed unstable — `SiteRecipe`, `SiteTemplateRecipe`. They must be
 * reachable from `./recipe/unstable` and absent from `./recipe`. They were
 * held back because every op the graduated kinds emit (`CreateItem`,
 * `SetField`, `AddItemVersion`) has a rollback inverse, whereas
 * `CreateSiteFromTemplate` and `MediaUpload` are deliberately warn-only.
 */
describe("graduated composition kinds", () => {
  const GRADUATED_EXPORTS = [
    "ContentItemRecipeSchema",
    "DictionaryPhraseSchema",
    "DictionaryRecipeSchema",
    "PageDesignRecipeSchema",
    "PartialDesignRecipeSchema",
    "compileContentItemRecipe",
    "compileDictionaryRecipe",
    "compilePageDesignRecipe",
    "compilePartialDesignRecipe",
  ] as const;

  it.each(GRADUATED_EXPORTS)("./recipe exports %s", (name) => {
    expect((recipe as Record<string, unknown>)[name]).toBeDefined();
  });

  // Deprecation window: drop this block (and the re-exports in
  // src/recipe/unstable.ts) in the next major.
  it.each(GRADUATED_EXPORTS)("./recipe/unstable still re-exports %s", (name) => {
    expect((recipeUnstable as Record<string, unknown>)[name]).toBeDefined();
  });

  it.each(GRADUATED_EXPORTS)("both entries resolve %s to the same binding", (name) => {
    expect((recipe as Record<string, unknown>)[name]).toBe(
      (recipeUnstable as Record<string, unknown>)[name]
    );
  });
});

describe("unstable recipe composition surface", () => {
  const COMPOSITION_EXPORTS = [
    "SiteGroupingSchema",
    "SiteRecipeSchema",
    "SiteTemplateRecipeSchema",
    "SiteTemplateTaxonomyEntrySchema",
    "compileSiteRecipe",
    "compileSiteTemplateRecipe",
  ] as const;

  it.each(COMPOSITION_EXPORTS)("./recipe/unstable exports %s", (name) => {
    expect((recipeUnstable as Record<string, unknown>)[name]).toBeDefined();
  });

  it.each(COMPOSITION_EXPORTS)("./recipe does NOT export %s", (name) => {
    expect((recipe as Record<string, unknown>)[name]).toBeUndefined();
  });
});

/**
 * Schema-only entry `./recipe/schema` — re-exports every kind schema (stable
 * AND unstable) plus the field-type tables, with NO compiler. Schema-only
 * consumers (e.g. the registry's client-reachable `sitecore-recipes` shim)
 * import here so their module graph never pulls `./compile` → `sandbox/
 * transpile` → esbuild. This pins both halves of that contract: the schemas
 * are present, and the compiler/IR symbols are absent.
 */
describe("schema-only recipe surface (./recipe/schema)", () => {
  const SCHEMA_EXPORTS = [
    // stable kinds
    "ComponentTemplateRecipeSchema",
    "ContentTemplateRecipeSchema",
    "DesignParametersTemplateRecipeSchema",
    "EnumerationRecipeSchema",
    "ComponentSectionRecipeSchema",
    "VariantRecipeSchema",
    "RecipeSchema",
    // composition kinds, graduated and unstable alike (schema/recipe owns them)
    "ContentItemRecipeSchema",
    "PageDesignRecipeSchema",
    "PartialDesignRecipeSchema",
    "SiteRecipeSchema",
    "SiteTemplateRecipeSchema",
    "DictionaryRecipeSchema",
    // field-type tables
    "FIELD_SHAPES",
    "FieldShapeSchema",
    "SITECORE_FIELD_TYPES",
    "SitecoreFieldTypeSchema",
  ] as const;

  // Compiler / IR / GUID symbols that MUST NOT leak into the schema entry —
  // their presence would mean the esbuild-bearing compile chain is reachable.
  const COMPILER_SYMBOLS = [
    "compileRecipe",
    "compileRecipeSet",
    "compileComponentTemplateRecipe",
    "buildPlan",
    "executeIr",
    "emitLayoutXml",
    "templateId",
  ] as const;

  it.each(SCHEMA_EXPORTS)("./recipe/schema exports %s", (name) => {
    expect((recipeSchema as Record<string, unknown>)[name]).toBeDefined();
  });

  it.each(COMPILER_SYMBOLS)("./recipe/schema does NOT export compiler symbol %s", (name) => {
    expect((recipeSchema as Record<string, unknown>)[name]).toBeUndefined();
  });

  it("validates a recipe via the schema-only surface", () => {
    const result = recipeSchema.ComponentTemplateRecipeSchema.safeParse({
      kind: "component-template",
      schemaVersion: "1",
      handle: "smoke@1",
      name: "Smoke",
      displayName: "Smoke",
      fields: [{ name: "Title", shape: "text" }],
    });
    expect(result.success).toBe(true);
  });
});
