import { describe, expect, it } from "vitest";
import { alarisRecipe } from "../../../example/recipes/alaris.recipe";
import { cclBrandTemplateRecipe } from "../../../example/recipes/ccl-brand-template.recipe";
import { solterraCoRecipe } from "../../../example/recipes/solterra-co.recipe";
import {
  RecipeSchema,
  SiteRecipeSchema,
  SiteTemplateRecipeSchema,
} from "../../../src/recipe/schema/recipe";

/**
 * Smoke parses for the SiteTemplate + SiteRecipe worked examples.
 *
 * The `satisfies` annotation in each fixture catches type-shape
 * regressions at compile time; these tests catch RUNTIME parse
 * regressions (e.g. a refine landing on the schema later that
 * makes existing fixtures invalid).
 */

describe("ccl-brand-template@1 worked example", () => {
  it("parses against SiteTemplateRecipeSchema", () => {
    const result = SiteTemplateRecipeSchema.safeParse(cclBrandTemplateRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.handle).toBe("ccl-brand-template@1");
      expect(result.data.pageTemplates).toHaveLength(5);
      expect(result.data.pageDesigns).toHaveLength(3);
      expect(Object.keys(result.data.insertOptionsMatrix ?? {})).toHaveLength(5);
      expect(Object.keys(result.data.templatesToDesigns ?? {})).toHaveLength(4);
      expect(result.data.dictionary).toHaveLength(6);
      expect(result.data.taxonomy).toHaveLength(2);
    }
  });

  it("dispatches via the Recipe discriminated union", () => {
    const result = RecipeSchema.safeParse(cclBrandTemplateRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("site-template");
    }
  });

  it("templatesToDesigns values reference handles in pageDesigns", () => {
    const designs = new Set(cclBrandTemplateRecipe.pageDesigns);
    for (const designHandle of Object.values(cclBrandTemplateRecipe.templatesToDesigns ?? {})) {
      expect(designs.has(designHandle)).toBe(true);
    }
  });

  it("insertOptionsMatrix values reference handles in pageTemplates", () => {
    const templates = new Set(cclBrandTemplateRecipe.pageTemplates);
    for (const allowed of Object.values(cclBrandTemplateRecipe.insertOptionsMatrix ?? {})) {
      for (const child of allowed) {
        expect(templates.has(child)).toBe(true);
      }
    }
  });
});

describe("solterra-co@1 worked example", () => {
  it("parses against SiteRecipeSchema", () => {
    const result = SiteRecipeSchema.safeParse(solterraCoRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.handle).toBe("solterra-co@1");
      expect(result.data.siteTemplate).toBe("ccl-brand-template@1");
      expect(result.data.collectionName).toBe("Click Click Launch");
      expect(result.data.collectionId).toBeUndefined();
      expect(result.data.dictionaryOverrides?.ContactUs).toBe("Get in touch with Solterra");
    }
  });

  it("dispatches via the Recipe discriminated union", () => {
    const result = RecipeSchema.safeParse(solterraCoRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("site");
    }
  });
});

describe("alaris@1 worked example", () => {
  it("parses against SiteRecipeSchema", () => {
    const result = SiteRecipeSchema.safeParse(alarisRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.handle).toBe("alaris@1");
      expect(result.data.siteTemplate).toBe("ccl-brand-template@1");
      expect(result.data.collectionId).toBeDefined();
      expect(result.data.collectionName).toBeUndefined();
    }
  });

  it("references the same SiteTemplate as solterra-co (multi-brand pattern)", () => {
    expect(alarisRecipe.siteTemplate).toBe(solterraCoRecipe.siteTemplate);
    expect(alarisRecipe.handle).not.toBe(solterraCoRecipe.handle);
  });
});
