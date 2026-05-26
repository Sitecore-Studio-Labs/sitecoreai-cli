import { describe, expect, it } from "vitest";
import {
  BRAND_KIT_CANONICAL_SECTIONS,
  BrandKitRecipeSchema,
} from "../../../../src/brand/recipe/schema";

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

/**
 * Registry-superset compatibility — the registry's
 * `sitecore-recipes.ts` defines a richer shape with `kind: "brandkit"`,
 * `schemaVersion`, `handle`, `displayName`, and a discriminated
 * `documents[]` union (`url` | `registry-file`) with `tags` / `sections`
 * hints. scai's schema must accept it round-trip so the orchestrator
 * can hand recipes through unchanged.
 */
describe("BrandKitRecipeSchema — registry superset", () => {
  it("parses the full registry-superset shape with both document variants", () => {
    const recipe = BrandKitRecipeSchema.parse({
      kind: "brandkit",
      schemaVersion: "1",
      handle: "acme-brand@1",
      name: "Acme",
      displayName: "Acme Brand",
      description: "Bold and confident",
      industry: "retail",
      documents: [
        {
          kind: "url",
          url: "https://cdn.acme.test/brand.pdf",
          title: "Brand Guidelines",
          tags: ["voice", "marketing"],
          sections: ["Tone of Voice", "Brand Context"],
        },
        {
          kind: "registry-file",
          path: "brand-docs/voice.pdf",
          title: "Voice & Tone",
          tags: ["voice"],
          sections: ["Tone of Voice"],
        },
      ],
      sections: { "Tone of Voice": { Voice: "Confident, warm" } },
    });
    expect(recipe.kind).toBe("brandkit");
    expect(recipe.schemaVersion).toBe("1");
    expect(recipe.handle).toBe("acme-brand@1");
    expect(recipe.displayName).toBe("Acme Brand");
    expect(recipe.documents).toHaveLength(2);
    expect(recipe.documents[0]).toMatchObject({
      kind: "url",
      url: "https://cdn.acme.test/brand.pdf",
      tags: ["voice", "marketing"],
      sections: ["Tone of Voice", "Brand Context"],
    });
    expect(recipe.documents[1]).toMatchObject({
      kind: "registry-file",
      path: "brand-docs/voice.pdf",
    });
  });

  it("accepts the legacy flat document shape (no `kind`) and defaults it to `url`", () => {
    const recipe = BrandKitRecipeSchema.parse({
      name: "Acme",
      documents: [{ url: "https://x.test/a.pdf", title: "x" }],
    });
    expect(recipe.documents[0]).toMatchObject({
      kind: "url",
      url: "https://x.test/a.pdf",
      title: "x",
    });
  });

  it("rejects a registry-file document with no path", () => {
    expect(() =>
      BrandKitRecipeSchema.parse({
        name: "Acme",
        documents: [{ kind: "registry-file", title: "x" }],
      })
    ).toThrow();
  });

  it("rejects an invalid handle that does not match `<kebab-name>@<major>`", () => {
    expect(() =>
      BrandKitRecipeSchema.parse({
        name: "Acme",
        handle: "AcmeBrand", // missing @<major>
      })
    ).toThrow();
  });

  it("rejects an invalid kind/schemaVersion literal", () => {
    expect(() => BrandKitRecipeSchema.parse({ name: "Acme", kind: "brand-kit" })).toThrow();
    expect(() => BrandKitRecipeSchema.parse({ name: "Acme", schemaVersion: "2" })).toThrow();
  });

  it("exports the canonical section names mirroring the registry's list", () => {
    expect([...BRAND_KIT_CANONICAL_SECTIONS]).toEqual([
      "Brand Context",
      "Global Goals",
      "Tone of Voice",
      "Glossary and Localization",
      "Do's and Don'ts",
      "Grammar Checklists",
      "Visual Guidelines",
    ]);
  });
});
