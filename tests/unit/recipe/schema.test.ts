import { describe, expect, it } from "vitest";
import {
  ComponentPlacementSchema,
  ComponentTemplateRecipeSchema,
  ContentItemRecipeSchema,
  PageDesignRecipeSchema,
  PartialDesignRecipeSchema,
  RecipeSchema,
  SiteRecipeSchema,
  SiteTemplateRecipeSchema,
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

describe("ComponentPlacement Zod schema", () => {
  it("accepts a minimal placement (only componentHandle)", () => {
    const result = ComponentPlacementSchema.safeParse({ componentHandle: "hero@1" });
    expect(result.success).toBe(true);
  });

  it("accepts variant + params + shared datasourceRef", () => {
    const result = ComponentPlacementSchema.safeParse({
      componentHandle: "hero@1",
      variant: "default",
      params: { Size: "lg" },
      datasourceRef: { kind: "shared", handle: "hero-content@1" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts scoped datasourceRef with a slot path", () => {
    const result = ComponentPlacementSchema.safeParse({
      componentHandle: "card-grid@1",
      datasourceRef: { kind: "scoped", slot: "/main/0" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts kind: 'none' (no datasource)", () => {
    const result = ComponentPlacementSchema.safeParse({
      componentHandle: "config-only@1",
      datasourceRef: { kind: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a componentHandle without major-version suffix", () => {
    const result = ComponentPlacementSchema.safeParse({ componentHandle: "hero" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown datasourceRef kind", () => {
    const result = ComponentPlacementSchema.safeParse({
      componentHandle: "hero@1",
      datasourceRef: { kind: "magic", value: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects shared datasourceRef with malformed handle", () => {
    const result = ComponentPlacementSchema.safeParse({
      componentHandle: "hero@1",
      datasourceRef: { kind: "shared", handle: "no-major" },
    });
    expect(result.success).toBe(false);
  });
});

describe("PartialDesignRecipe Zod schema", () => {
  const minimalPartial = {
    kind: "partial-design" as const,
    schemaVersion: "1" as const,
    handle: "standard-header@1",
    name: "StandardHeader",
    displayName: "Standard Header",
    layout: {
      placeholders: {
        "/header": [{ componentHandle: "site-logo@1" }],
      },
    },
  };

  it("accepts a typical partial-design recipe", () => {
    const result = PartialDesignRecipeSchema.safeParse(minimalPartial);
    expect(result.success).toBe(true);
  });

  it("defaults layout.placeholders to {} when omitted", () => {
    const result = PartialDesignRecipeSchema.safeParse({
      ...minimalPartial,
      layout: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.layout.placeholders).toEqual({});
    }
  });

  it("requires the layout block", () => {
    const rest = { ...minimalPartial } as Partial<typeof minimalPartial>;
    delete rest.layout;
    const result = PartialDesignRecipeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a handle without major-version suffix", () => {
    const result = PartialDesignRecipeSchema.safeParse({
      ...minimalPartial,
      handle: "standard-header",
    });
    expect(result.success).toBe(false);
  });
});

describe("PageDesignRecipe Zod schema", () => {
  const minimalDesign = {
    kind: "page-design" as const,
    schemaVersion: "1" as const,
    handle: "default-page-design@1",
    name: "DefaultPageDesign",
    displayName: "Default Page Design",
    appliesTo: ["home-page@1"],
    partials: ["standard-header@1", "standard-footer@1"],
  };

  it("accepts a typical page-design recipe (no own layout)", () => {
    const result = PageDesignRecipeSchema.safeParse(minimalDesign);
    expect(result.success).toBe(true);
  });

  it("accepts an own layout block", () => {
    const result = PageDesignRecipeSchema.safeParse({
      ...minimalDesign,
      layout: {
        placeholders: {
          "/page-design-cta": [{ componentHandle: "cta-banner@1" }],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("defaults appliesTo and partials to empty arrays when omitted", () => {
    const result = PageDesignRecipeSchema.safeParse({
      kind: "page-design",
      schemaVersion: "1",
      handle: "blank@1",
      name: "Blank",
      displayName: "Blank",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appliesTo).toEqual([]);
      expect(result.data.partials).toEqual([]);
    }
  });

  it("rejects a malformed page-template handle in appliesTo", () => {
    const result = PageDesignRecipeSchema.safeParse({
      ...minimalDesign,
      appliesTo: ["home-page"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed partial handle in partials", () => {
    const result = PageDesignRecipeSchema.safeParse({
      ...minimalDesign,
      partials: ["standard-header"],
    });
    expect(result.success).toBe(false);
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

  it("dispatches on kind: partial-design", () => {
    const result = RecipeSchema.safeParse({
      kind: "partial-design",
      schemaVersion: "1",
      handle: "x@1",
      name: "X",
      displayName: "X",
      layout: { placeholders: {} },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("partial-design");
    }
  });

  it("dispatches on kind: page-design", () => {
    const result = RecipeSchema.safeParse({
      kind: "page-design",
      schemaVersion: "1",
      handle: "x@1",
      name: "X",
      displayName: "X",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("page-design");
    }
  });

  it("dispatches on kind: site-template", () => {
    const result = RecipeSchema.safeParse({
      kind: "site-template",
      schemaVersion: "1",
      handle: "x@1",
      name: "X",
      displayName: "X",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("site-template");
    }
  });

  it("dispatches on kind: site", () => {
    const result = RecipeSchema.safeParse({
      kind: "site",
      schemaVersion: "1",
      handle: "x@1",
      name: "X",
      displayName: "X",
      siteTemplate: "y@1",
      language: "en",
      collectionName: "Brand A",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("site");
    }
  });
});

const baseSiteTemplate = {
  kind: "site-template" as const,
  schemaVersion: "1" as const,
  handle: "ccl-brand-template@1",
  name: "ClickClickLaunchBrand",
  displayName: "Click Click Launch Brand Template",
};

describe("SiteTemplateRecipe Zod schema", () => {
  it("accepts the minimum shape (just kind + handle + name + displayName)", () => {
    const result = SiteTemplateRecipeSchema.safeParse(baseSiteTemplate);
    expect(result.success).toBe(true);
    if (result.success) {
      // Default arrays initialised
      expect(result.data.pageTemplates).toEqual([]);
      expect(result.data.pageDesigns).toEqual([]);
    }
  });

  it("accepts a full template with all optional sections", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      description: "Reusable click-click-launch brand template",
      pageTemplates: ["home-page@1", "article-page@1", "landing-page@1"],
      insertOptionsMatrix: {
        "home-page@1": ["article-page@1", "landing-page@1"],
        "article-page@1": ["article-page@1"],
      },
      pageDesigns: ["default-page-design@1", "landing-design@1"],
      templatesToDesigns: {
        "home-page@1": "default-page-design@1",
        "landing-page@1": "landing-design@1",
      },
      dictionary: [
        { phrase: "ContactUs", defaultValue: "Contact Us" },
        { phrase: "ReadMore", defaultValue: "Read more" },
      ],
      taxonomy: [{ root: "Content Types", defaultTags: ["Article", "Landing"] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a handle without a major-version suffix", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      handle: "ccl-brand-template",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a pageTemplates entry that doesn't match HANDLE_PATTERN", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      pageTemplates: ["home-page@1", "Bad Handle"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an insertOptionsMatrix value that contains a malformed handle", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      insertOptionsMatrix: {
        "home-page@1": ["article-page@1", "no-version"],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a templatesToDesigns key that isn't a handle", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      templatesToDesigns: { "Not A Handle": "default-page-design@1" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a dictionary entry missing `phrase`", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      dictionary: [{ defaultValue: "Read more" }],
    });
    expect(result.success).toBe(false);
  });
});

const baseSite = {
  kind: "site" as const,
  schemaVersion: "1" as const,
  handle: "solterra-co@1",
  name: "SolterraCo",
  displayName: "Solterra & Co",
  siteTemplate: "ccl-brand-template@1",
  language: "en",
  collectionName: "Click Click Launch",
};

describe("SiteRecipe Zod schema", () => {
  it("accepts the minimum shape (handle + name + displayName + siteTemplate + language + collectionName)", () => {
    const result = SiteRecipeSchema.safeParse(baseSite);
    expect(result.success).toBe(true);
  });

  it("accepts a fully-specified site with overrides + grouping", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      description: "Solterra brand site",
      languages: ["en", "da"],
      siteGrouping: {
        hostName: "solterra.example.com",
        language: "en",
      },
      dictionaryOverrides: {
        ContactUs: "Get in touch with Solterra",
      },
      taxonomyOverrides: {
        "Content Types": ["Article", "Landing", "Audio"],
      },
      initialHome: "solterra-home@1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an existing collectionId instead of collectionName", () => {
    const withoutCollectionName: Omit<typeof baseSite, "collectionName"> & {
      collectionName?: string;
    } = { ...baseSite };
    delete withoutCollectionName.collectionName;
    const result = SiteRecipeSchema.safeParse({
      ...withoutCollectionName,
      collectionId: "5aae1eeaea2440bf96f11f43da82c77b",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed handle", () => {
    const result = SiteRecipeSchema.safeParse({ ...baseSite, handle: "no-version" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed siteTemplate handle", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      siteTemplate: "ccl-brand-template",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a language shorter than 2 chars", () => {
    const result = SiteRecipeSchema.safeParse({ ...baseSite, language: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed initialHome handle", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      initialHome: "not-a-handle",
    });
    expect(result.success).toBe(false);
  });

  it("accepts dictionaryOverrides with arbitrary string values", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      dictionaryOverrides: { ContactUs: "" },
    });
    // Empty string is allowed — overriding a phrase with empty is valid
    expect(result.success).toBe(true);
  });

  it("rejects taxonomyOverrides with empty tag strings", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      taxonomyOverrides: { "Content Types": ["Article", ""] },
    });
    expect(result.success).toBe(false);
  });

  // The plan calls collectionId / collectionName mutually exclusive AND
  // exactly-one-required. Zod's discriminated-union member can't carry
  // refinements (would break the union), so the cross-field constraint is
  // enforced at compile time, not by the schema. Schema parse accepts:
  //   - both together (compiler would reject)
  //   - neither (compiler would reject)
  // These tests pin the parse-level behaviour; the compile path enforces
  // the XOR (Phase 4 follow-up — `compileSiteRecipe`).
  it("schema accepts both collectionId AND collectionName (compiler enforces XOR)", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      collectionId: "abc",
      // baseSite already has collectionName
    });
    expect(result.success).toBe(true);
  });

  it("schema accepts neither collectionId NOR collectionName (compiler enforces presence)", () => {
    const withoutCollectionName: Omit<typeof baseSite, "collectionName"> & {
      collectionName?: string;
    } = { ...baseSite };
    delete withoutCollectionName.collectionName;
    const result = SiteRecipeSchema.safeParse(withoutCollectionName);
    expect(result.success).toBe(true);
  });
});
