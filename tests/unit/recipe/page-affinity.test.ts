import { describe, expect, it } from "vitest";

import { PageRecipeSchema } from "../../../src/recipe/schema/recipe";
import { PageAffinityFacetSchema } from "../../../src/recipe/schema/shared";

/** Minimal valid page recipe — affinity is layered on top per test. */
const basePage = {
  kind: "page",
  schemaVersion: "1",
  handle: "formalux-home@1",
  name: "FormaluxHome",
  displayName: "Forma Lux — Home",
  template: "page@1",
} as const;

describe("PageAffinityFacetSchema", () => {
  it("accepts a facet declaring one or more axes", () => {
    const result = PageAffinityFacetSchema.safeParse({
      dimensions: {
        category: ["living-room", "sofas"],
        brand: ["formalux"],
        topic: ["sustainable-luxury"],
      },
      weight: 2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a single-axis facet", () => {
    expect(PageAffinityFacetSchema.safeParse({ dimensions: { category: ["beds"] } }).success).toBe(
      true
    );
  });

  it("rejects a facet with no tags on any axis", () => {
    expect(PageAffinityFacetSchema.safeParse({ dimensions: {} }).success).toBe(false);
    expect(PageAffinityFacetSchema.safeParse({ dimensions: { category: [] } }).success).toBe(false);
  });

  it("rejects empty-string tags", () => {
    expect(PageAffinityFacetSchema.safeParse({ dimensions: { category: [""] } }).success).toBe(
      false
    );
  });

  it("rejects a non-positive weight", () => {
    expect(
      PageAffinityFacetSchema.safeParse({
        dimensions: { category: ["x"] },
        weight: 0,
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys (strict facet)", () => {
    expect(
      PageAffinityFacetSchema.safeParse({
        dimensions: { category: ["x"] },
        rank: 3,
      }).success
    ).toBe(false);
  });
});

describe("PageRecipe affinity facet", () => {
  it("accepts a page without an affinity facet (optional)", () => {
    expect(PageRecipeSchema.safeParse(basePage).success).toBe(true);
  });

  it("accepts a page carrying a valid affinity facet", () => {
    const result = PageRecipeSchema.safeParse({
      ...basePage,
      affinity: {
        dimensions: {
          category: ["living-room"],
          brand: ["formalux"],
          topic: ["sustainable-luxury"],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affinity?.dimensions.category).toEqual(["living-room"]);
    }
  });

  it("rejects a page whose affinity facet declares no tags", () => {
    expect(PageRecipeSchema.safeParse({ ...basePage, affinity: { dimensions: {} } }).success).toBe(
      false
    );
  });
});
