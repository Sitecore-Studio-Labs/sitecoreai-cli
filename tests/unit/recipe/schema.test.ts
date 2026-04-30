import { describe, expect, it } from "vitest";
import { ComponentTemplateRecipeSchema } from "../../../src/recipe/schema/recipe";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";

describe("ComponentTemplateRecipe Zod schema", () => {
  it("accepts the cta-button worked example", () => {
    const result = ComponentTemplateRecipeSchema.safeParse(ctaButtonRecipe);
    expect(result.success).toBe(true);
  });

  it("rejects a handle without a major-version suffix", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      ...ctaButtonRecipe,
      handle: "cta-button",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a handle that uses uppercase or whitespace", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      ...ctaButtonRecipe,
      handle: "Cta Button@1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown field shape", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      ...ctaButtonRecipe,
      fields: [{ name: "Label", shape: "magic-text" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown sitecore.type override", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      ...ctaButtonRecipe,
      fields: [
        {
          name: "Label",
          shape: "text",
          sitecore: { type: "not-a-real-sitecore-type" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires `name` (the React export name)", () => {
    const rest = { ...ctaButtonRecipe } as Partial<typeof ctaButtonRecipe>;
    delete rest.name;
    const result = ComponentTemplateRecipeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts a minimal recipe with empty fields, variants, and params", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      kind: "component-template",
      schemaVersion: "1",
      handle: "minimal@1",
      name: "Minimal",
      displayName: "Minimal",
      rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fields).toEqual([]);
      expect(result.data.variants).toEqual([]);
      expect(result.data.params).toEqual([]);
    }
  });
});
