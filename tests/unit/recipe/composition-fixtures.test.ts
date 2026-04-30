import { describe, expect, it } from "vitest";
import { articleBylineRecipe } from "../../../example/recipes/article-byline.recipe";
import { articleDesignRecipe } from "../../../example/recipes/article-design.recipe";
import { defaultPageDesignRecipe } from "../../../example/recipes/default-page-design.recipe";
import { landingDesignRecipe } from "../../../example/recipes/landing-design.recipe";
import { primaryNavContentRecipe } from "../../../example/recipes/primary-nav-content.recipe";
import { siteLogoContentRecipe } from "../../../example/recipes/site-logo-content.recipe";
import { standardFooterRecipe } from "../../../example/recipes/standard-footer.recipe";
import { standardHeaderRecipe } from "../../../example/recipes/standard-header.recipe";
import {
  ContentItemRecipeSchema,
  PageDesignRecipeSchema,
  PartialDesignRecipeSchema,
  RecipeSchema,
} from "../../../src/recipe/schema/recipe";

/**
 * Fixture parse coverage for Phase 4's composition layer.
 *
 * Hand-authoring before compiler work surfaces schema gaps — same pattern
 * that made Phase 1 land cleanly. Each fixture must:
 *   1. parse against its kind's schema
 *   2. parse via the top-level `Recipe` discriminated union
 *
 * If any fixture fails to parse, the schema is missing a real-world
 * shape — fix the schema before writing the compiler dispatcher.
 */

const PARTIAL_FIXTURES = [
  ["standard-header@1", standardHeaderRecipe],
  ["standard-footer@1", standardFooterRecipe],
  ["article-byline@1", articleBylineRecipe],
] as const;

const PAGE_DESIGN_FIXTURES = [
  ["default-page-design@1", defaultPageDesignRecipe],
  ["landing-design@1", landingDesignRecipe],
  ["article-design@1", articleDesignRecipe],
] as const;

const CONTENT_ITEM_FIXTURES = [
  ["site-logo-content@1", siteLogoContentRecipe],
  ["primary-nav-content@1", primaryNavContentRecipe],
] as const;

describe("Phase 4 composition fixtures — partial-design recipes parse", () => {
  it.each(PARTIAL_FIXTURES)("%s parses against PartialDesignRecipeSchema", (_handle, recipe) => {
    const result = PartialDesignRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
  });

  it.each(PARTIAL_FIXTURES)(
    "%s parses against the top-level Recipe discriminated union",
    (_handle, recipe) => {
      const result = RecipeSchema.safeParse(recipe);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe("partial-design");
      }
    }
  );
});

describe("Phase 4 composition fixtures — page-design recipes parse", () => {
  it.each(PAGE_DESIGN_FIXTURES)("%s parses against PageDesignRecipeSchema", (_handle, recipe) => {
    const result = PageDesignRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
  });

  it.each(PAGE_DESIGN_FIXTURES)(
    "%s parses against the top-level Recipe discriminated union",
    (_handle, recipe) => {
      const result = RecipeSchema.safeParse(recipe);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe("page-design");
      }
    }
  );
});

describe("Phase 4 composition fixtures — supporting content-item recipes parse", () => {
  it.each(CONTENT_ITEM_FIXTURES)("%s parses against ContentItemRecipeSchema", (_handle, recipe) => {
    const result = ContentItemRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
  });
});

describe("Phase 4 composition fixtures — cross-fixture consistency", () => {
  it("article-design references article-byline (the partial unique to articles)", () => {
    expect(articleDesignRecipe.partials).toContain("article-byline@1");
  });

  it("default-page-design and article-design both reference standard-footer (shared partial)", () => {
    expect(defaultPageDesignRecipe.partials).toContain("standard-footer@1");
    expect(articleDesignRecipe.partials).toContain("standard-footer@1");
  });

  it("landing-design has only standard-footer (no header — landing UX choice)", () => {
    expect(landingDesignRecipe.partials).toEqual(["standard-footer@1"]);
  });

  it("article-design partials are in the documented render order [header, byline, footer]", () => {
    expect(articleDesignRecipe.partials).toEqual([
      "standard-header@1",
      "article-byline@1",
      "standard-footer@1",
    ]);
  });

  it("each page design maps to a distinct page-template handle", () => {
    expect(defaultPageDesignRecipe.appliesTo).toEqual(["home-page@1"]);
    expect(landingDesignRecipe.appliesTo).toEqual(["landing-page@1"]);
    expect(articleDesignRecipe.appliesTo).toEqual(["article-page@1"]);
  });
});
