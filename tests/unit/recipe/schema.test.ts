import { describe, expect, it } from "vitest";
import {
  ComponentTemplateRecipeSchema,
  ContentItemRecipeSchema,
  RecipeSchema,
  SitecoreFieldAugmentSchema,
} from "../../../src/recipe/schema/recipe";
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

describe("SitecoreFieldAugment — sourceRaw mutual exclusion", () => {
  it("accepts sourceTypes alone", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({ sourceTypes: ["a@1"] });
    expect(result.success).toBe(true);
  });

  it("accepts sourceRaw alone", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({ sourceRaw: "/sitecore/content/Tags" });
    expect(result.success).toBe(true);
  });

  it("rejects sourceRaw combined with sourceTypes", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({
      sourceRaw: "/literal",
      sourceTypes: ["a@1"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects sourceRaw combined with sourceQuery", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({
      sourceRaw: "/literal",
      sourceQuery: "$site/Data",
    });
    expect(result.success).toBe(false);
  });

  it("rejects sourceRaw combined with sourceScope", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({
      sourceRaw: "/literal",
      sourceScope: "/sitecore/content",
    });
    expect(result.success).toBe(false);
  });
});

describe("ContentItemRecipe Zod schema", () => {
  const minimalContentItem = {
    kind: "content-item" as const,
    schemaVersion: "1" as const,
    handle: "site-logo-content@1",
    name: "SiteLogo",
    displayName: "Site Logo",
    templateType: "site-logo-template@1",
    fields: {
      Image: {
        shape: "image" as const,
        mediaPath: "/sitecore/media-library/Project/Logo",
        alt: "Logo",
      },
      Tagline: { shape: "text" as const, value: "Welcome" },
    },
  };

  it("accepts a typical content-item recipe", () => {
    const result = ContentItemRecipeSchema.safeParse(minimalContentItem);
    expect(result.success).toBe(true);
  });

  it("defaults fields to an empty object when omitted", () => {
    const rest = { ...minimalContentItem } as Partial<typeof minimalContentItem>;
    delete rest.fields;
    const result = ContentItemRecipeSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fields).toEqual({});
    }
  });

  it("rejects a handle without a major-version suffix", () => {
    const result = ContentItemRecipeSchema.safeParse({
      ...minimalContentItem,
      handle: "site-logo-content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a templateType handle without a major-version suffix", () => {
    const result = ContentItemRecipeSchema.safeParse({
      ...minimalContentItem,
      templateType: "site-logo-template",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown field-value shape", () => {
    const result = ContentItemRecipeSchema.safeParse({
      ...minimalContentItem,
      fields: { X: { shape: "unknown-shape", value: "x" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an integer field-value with a non-integer number", () => {
    const result = ContentItemRecipeSchema.safeParse({
      ...minimalContentItem,
      fields: { Count: { shape: "integer", value: 1.5 } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts each value shape end-to-end", () => {
    const result = ContentItemRecipeSchema.safeParse({
      ...minimalContentItem,
      fields: {
        T: { shape: "text", value: "x" },
        R: { shape: "richText", value: "<p>x</p>" },
        B: { shape: "boolean", value: true },
        N: { shape: "number", value: 1.5 },
        I: { shape: "integer", value: 2 },
        D: { shape: "date", value: "2026-04-30" },
        DT: { shape: "datetime", value: "2026-04-30T12:00:00Z" },
        E: { shape: "enum", value: "default" },
        Img: { shape: "image", mediaPath: "/m", alt: "a", width: 100, height: 50 },
        Lx: { shape: "link-external", href: "https://example.com", text: "Click" },
        Li: { shape: "link-internal", ref: "home@1", text: "Home" },
        Ref: { shape: "reference", refs: ["a@1", "b@1"] },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("Recipe discriminated union", () => {
  it("dispatches on kind: content-item", () => {
    const result = RecipeSchema.safeParse({
      kind: "content-item",
      schemaVersion: "1",
      handle: "x@1",
      name: "X",
      displayName: "X",
      templateType: "y@1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("content-item");
    }
  });
});
