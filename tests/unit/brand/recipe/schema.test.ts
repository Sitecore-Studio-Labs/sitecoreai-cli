import { describe, expect, it } from "vitest";
import { BrandKitRecipeSchema } from "../../../../src/brand/recipe/schema";

describe("BrandKitRecipeSchema", () => {
  it("parses a minimal recipe and applies defaults", () => {
    const recipe = BrandKitRecipeSchema.parse({ name: "Acme" });
    expect(recipe.name).toBe("Acme");
    expect(recipe.documents).toEqual([]);
    expect(recipe.sections).toEqual({});
  });

  it("rejects a recipe with no name", () => {
    expect(() => BrandKitRecipeSchema.parse({})).toThrow();
    expect(() => BrandKitRecipeSchema.parse({ name: "" })).toThrow();
  });

  it("accepts documents and section field values of every shape", () => {
    const recipe = BrandKitRecipeSchema.parse({
      name: "Acme",
      industry: "retail",
      documents: [{ url: "https://example.test/brand.pdf", title: "Guidelines" }],
      sections: {
        "Tone of Voice": {
          Voice: "Confident, warm",
          Personality: ["Bold", "Approachable"],
          Glossary: [{ name: "Sign in", restrictions: 'Never "log in"' }],
        },
      },
    });
    expect(recipe.documents).toHaveLength(1);
    expect(recipe.sections["Tone of Voice"].Voice).toBe("Confident, warm");
    expect(recipe.sections["Tone of Voice"].Personality).toEqual(["Bold", "Approachable"]);
  });

  it("rejects a document with no url", () => {
    expect(() =>
      BrandKitRecipeSchema.parse({ name: "Acme", documents: [{ title: "x" }] })
    ).toThrow();
  });
});
