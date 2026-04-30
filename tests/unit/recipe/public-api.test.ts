import { describe, expect, it } from "vitest";
import * as recipe from "../../../src/recipe";

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
    // Recipe author surface
    "ComponentPlacementSchema",
    "ComponentTemplateRecipeSchema",
    "ContentFieldValueSchema",
    "ContentItemRecipeSchema",
    "ContentTemplateRecipeSchema",
    "FieldDefinitionSchema",
    "LayoutSchema",
    "PageDesignRecipeSchema",
    "ParamDefinitionSchema",
    "PartialDesignRecipeSchema",
    "PlaceholderDefinitionSchema",
    "RecipeSchema",
    "RenderingDefinitionSchema",
    "RenderingVariantDefinitionSchema",
    "SitecoreFieldAugmentSchema",
    // Field types / shapes
    "FIELD_SHAPES",
    "FieldShapeSchema",
    "SITECORE_FIELD_TYPES",
    "SitecoreFieldTypeSchema",
    "defaultSitecoreFieldType",
    "sitecoreFieldTypeLabel",
    // Compiler
    "compileComponentTemplateRecipe",
    "compileContentTemplateRecipe",
    "compileRecipe",
    // GUID derivation (subset — the most-used ones)
    "templateId",
    "renderingId",
    "fieldId",
    "sectionId",
    "paramsTemplateId",
    "variantId",
    "variantsFolderId",
    "contentItemId",
    "partialDesignId",
    "pageDesignId",
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
    "DEFAULT_ICON",
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
      rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
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
        rendering: {
          datasourceLocation: "current-item",
          openPropertiesAfterAdd: false,
        },
      },
      {
        templatesRoot: "/sitecore/templates/Project/test/Components",
        renderingsRoot: "/sitecore/layout/Renderings/Project/test",
      }
    );
    expect(ir.schemaVersion).toBe("1");
    expect(ir.recipeHandle).toBe("smoke@1");
    expect(ir.operations.length).toBeGreaterThan(0);
  });
});
