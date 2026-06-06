import { describe, expect, it } from "vitest";
import * as recipe from "../../../src/recipe";
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
    // Recipe author surface (composition kinds live on ./recipe/unstable)
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
    // Compiler (composition-kind compilers live on ./recipe/unstable)
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
 * The recipe composition kinds are deliberately NOT on the stable `./recipe`
 * entry — they ship on `./recipe/unstable` without a 0.1.0 stability promise
 * (see `.changeset/recipes-graduation.md`). This pins that split: the
 * composition symbols must be reachable from `./recipe/unstable` and absent
 * from `./recipe`.
 */
describe("unstable recipe composition surface", () => {
  const COMPOSITION_EXPORTS = [
    "ContentItemRecipeSchema",
    "DictionaryPhraseSchema",
    "DictionaryRecipeSchema",
    "PageDesignRecipeSchema",
    "PartialDesignRecipeSchema",
    "SiteGroupingSchema",
    "SiteRecipeSchema",
    "SiteTemplateRecipeSchema",
    "SiteTemplateTaxonomyEntrySchema",
    "compileContentItemRecipe",
    "compileDictionaryRecipe",
    "compilePageDesignRecipe",
    "compilePartialDesignRecipe",
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
