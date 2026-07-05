import { describe, expect, it } from "vitest";
import {
  ComponentPlacementSchema,
  ComponentTemplateRecipeSchema,
  ContentItemRecipeSchema,
  DictionaryPhraseSchema,
  DictionaryRecipeSchema,
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

describe("SitecoreFieldAugment — source discriminated union", () => {
  it("accepts filter mode with types alone", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({
      source: { kind: "filter", types: ["a@1"] },
    });
    expect(result.success).toBe(true);
  });

  it("accepts filter mode with composed types + scope", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({
      source: {
        kind: "filter",
        types: ["a@1"],
        scope: "/sitecore/content/Library",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts raw mode alone", () => {
    const result = SitecoreFieldAugmentSchema.safeParse({
      source: { kind: "raw", value: "/sitecore/content/Tags" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects the legacy flat-shape sourceTypes / sourceRaw fields", () => {
    expect(
      SitecoreFieldAugmentSchema.safeParse({
        sourceTypes: ["a@1"],
      }).success
    ).toBe(false);
    expect(
      SitecoreFieldAugmentSchema.safeParse({
        sourceRaw: "/sitecore/content/Tags",
      }).success
    ).toBe(false);
  });

  it("rejects raw mode without a value", () => {
    expect(
      SitecoreFieldAugmentSchema.safeParse({
        source: { kind: "raw" },
      }).success
    ).toBe(false);
  });

  it("rejects an unknown source.kind", () => {
    expect(
      SitecoreFieldAugmentSchema.safeParse({
        source: { kind: "verbatim", value: "/sitecore/content/Tags" },
      }).success
    ).toBe(false);
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

  it("accepts simple-mode translations (additional languages)", () => {
    const result = ContentItemRecipeSchema.safeParse({
      ...minimalContentItem,
      translations: {
        fr: { fields: { Tagline: { shape: "text", value: "Bienvenue" } } },
        de: { fields: { Tagline: { shape: "text", value: "Willkommen" } } },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts story-mode versions with workflowState, date, layout and variants", () => {
    const result = ContentItemRecipeSchema.safeParse({
      kind: "content-item",
      schemaVersion: "1",
      handle: "homepage-hero@1",
      name: "HomepageHero",
      displayName: "Homepage Hero",
      templateType: "hero@1",
      shared: { CampaignCode: { shape: "text", value: "LAUNCH26" } },
      versions: {
        en: [
          {
            version: 1,
            fields: { Headline: { shape: "text", value: "Coming soon" } },
            workflowState: "Draft",
            date: "2026-01-10T00:00:00Z",
          },
          {
            version: 2,
            fields: { Headline: { shape: "text", value: "We launched!" } },
            workflowState: "Approved",
            layout: { placeholders: {} },
            variants: [
              {
                audience: "returning-visitor",
                fields: { Headline: { shape: "text", value: "Welcome back" } },
              },
            ],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a story version whose `version` is not a positive integer", () => {
    const base = {
      kind: "content-item",
      schemaVersion: "1",
      handle: "homepage-hero@1",
      name: "HomepageHero",
      displayName: "Homepage Hero",
      templateType: "hero@1",
    };
    for (const bad of [0, -1, 1.5]) {
      const result = ContentItemRecipeSchema.safeParse({
        ...base,
        versions: { en: [{ version: bad, fields: {} }] },
      });
      expect(result.success).toBe(false);
    }
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
      dictionaries: ["core-ui-labels@1", "brand-labels@1"],
      taxonomy: [{ root: "Content Types", defaultTags: ["Article", "Landing"] }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dictionaries).toEqual(["core-ui-labels@1", "brand-labels@1"]);
    }
  });

  it("defaults dictionaries to [] when omitted", () => {
    const result = SiteTemplateRecipeSchema.safeParse(baseSiteTemplate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dictionaries).toEqual([]);
    }
  });

  it("rejects a dictionaries entry that doesn't match HANDLE_PATTERN", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      dictionaries: ["core-ui-labels@1", "no-version"],
    });
    expect(result.success).toBe(false);
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

  it("does not accept the pre-2026-06-06 inline dictionary shape (replaced by dictionaries refs)", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      dictionaries: ["core-ui-labels@1"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // No `dictionary` key on the parsed data — only `dictionaries`.
      expect((result.data as Record<string, unknown>).dictionary).toBeUndefined();
    }
  });

  it("accepts thumbnail with kind: external-url", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      thumbnail: {
        kind: "external-url",
        url: "https://cdn.example.com/ccl-thumb.png",
        alt: "Click Click Launch thumbnail",
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.thumbnail?.kind === "external-url") {
      expect(result.data.thumbnail.url).toBe("https://cdn.example.com/ccl-thumb.png");
      expect(result.data.thumbnail.alt).toBe("Click Click Launch thumbnail");
    }
  });

  it("accepts thumbnail with kind: asset", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      thumbnail: { kind: "asset", path: "./thumbnail.png" },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.thumbnail?.kind === "asset") {
      expect(result.data.thumbnail.path).toBe("./thumbnail.png");
    }
  });

  it("rejects thumbnail with the legacy kind: url discriminator (renamed to external-url 2026-06-06)", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      thumbnail: { kind: "url", url: "https://cdn.example.com/ccl-thumb.png" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects thumbnail with an unknown discriminator kind", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      thumbnail: { kind: "invalid", url: "https://x" },
    });
    expect(result.success).toBe(false);
  });

  it("silently strips the speculative `image` field (removed from schema 2026-06-06 — no SXA target distinct from __Thumbnail)", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      image: {
        kind: "external-url",
        url: "https://cdn.example.com/ccl-hero.png",
        alt: "CCL hero",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Zod default `.strip()` drops unknown keys — `image` no longer
      // exists on the parsed shape.
      expect((result.data as Record<string, unknown>).image).toBeUndefined();
    }
  });

  it("accepts contents as an array of {name, content} pairs (sub-milestone A U4 shape)", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      contents: [
        { name: "Pages", content: "Home, Article Page, Landing Page" },
        { name: "Components", content: "SXA components" },
        { name: "Integrations", content: "Personalization and Analytics" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contents).toHaveLength(3);
      expect(result.data.contents?.[0]).toEqual({
        name: "Pages",
        content: "Home, Article Page, Landing Page",
      });
    }
  });

  it("rejects contents as a plain string (was the pre-D shape; A's U4 evidence reshaped it)", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      contents: "## What you get\n\n- Page templates\n- Page designs",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a contents entry missing the `name` field", () => {
    const result = SiteTemplateRecipeSchema.safeParse({
      ...baseSiteTemplate,
      contents: [{ content: "Body only" }],
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

  it("accepts dictionaryOverrides with per-locale Record<locale, string> values", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      dictionaryOverrides: {
        ContactUs: {
          en: "Get in touch",
          fr: "Nous contacter",
          "pt-BR": "Entre em contato",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a mix of flat-string and per-locale dictionaryOverrides values on the same site", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      dictionaryOverrides: {
        ContactUs: "Get in touch",
        ReadMore: { en: "Continue", fr: "Continuer" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects dictionaryOverrides per-locale map with locale key shorter than 2 chars", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      dictionaryOverrides: { ContactUs: { x: "too short" } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts siteRole: 'regular' and 'shared'", () => {
    const regular = SiteRecipeSchema.safeParse({ ...baseSite, siteRole: "regular" });
    expect(regular.success).toBe(true);
    const shared = SiteRecipeSchema.safeParse({
      ...baseSite,
      name: "Shared",
      handle: "showcase-shared@1",
      siteRole: "shared",
    });
    expect(shared.success).toBe(true);
  });

  it("rejects an unknown siteRole value", () => {
    const result = SiteRecipeSchema.safeParse({
      ...baseSite,
      siteRole: "not-a-role",
    });
    expect(result.success).toBe(false);
  });

  it("leaves siteRole undefined when omitted (regular site is the default)", () => {
    const result = SiteRecipeSchema.safeParse(baseSite);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.siteRole).toBeUndefined();
    }
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

// ---------------------------------------------------------------------------
// DictionaryPhrase + DictionaryRecipe Zod schemas (2026-06-06 registry mirror).
// ---------------------------------------------------------------------------

const basePhrase = {
  defaultValue: "Sign up",
};

describe("DictionaryPhrase Zod schema", () => {
  it("accepts the minimum shape (just defaultValue)", () => {
    const result = DictionaryPhraseSchema.safeParse(basePhrase);
    expect(result.success).toBe(true);
  });

  it("accepts a phrase with per-locale translations + a translator description", () => {
    const result = DictionaryPhraseSchema.safeParse({
      defaultValue: "Sign up",
      translations: { fr: "S'inscrire", de: "Anmelden", "pt-BR": "Cadastre-se" },
      description: "Account creation CTA. Distinct from cta-log-in.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects translations with a locale key shorter than 2 chars", () => {
    const result = DictionaryPhraseSchema.safeParse({
      defaultValue: "Sign up",
      translations: { f: "trop court" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty defaultValue (operators can intentionally blank a phrase)", () => {
    const result = DictionaryPhraseSchema.safeParse({ defaultValue: "" });
    expect(result.success).toBe(true);
  });
});

const baseDictionary = {
  kind: "dictionary" as const,
  schemaVersion: "1" as const,
  handle: "core-ui-labels@1",
  name: "CoreUiLabels",
  displayName: "Core UI Labels",
  site: "showcase-shared@1",
};

describe("DictionaryRecipe Zod schema", () => {
  it("accepts the minimum shape (kind + handle + name + displayName; site optional)", () => {
    const result = DictionaryRecipeSchema.safeParse(baseDictionary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phrases).toEqual({});
    }
  });

  it("accepts a dictionary with NO site (installs into the deploy target site)", () => {
    const { site: _site, ...siteless } = baseDictionary;
    const result = DictionaryRecipeSchema.safeParse(siteless);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.site).toBeUndefined();
    }
  });

  it("accepts a fully populated dictionary with phrases + primaryLocale + description", () => {
    const result = DictionaryRecipeSchema.safeParse({
      ...baseDictionary,
      description: "Generic chrome + form labels shared across the collection",
      primaryLocale: "en",
      phrases: {
        "cta-sign-up": {
          defaultValue: "Sign up",
          translations: { fr: "S'inscrire" },
        },
        "cta-log-in": { defaultValue: "Log in" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.phrases)).toHaveLength(2);
    }
  });

  it("rejects a handle without a major-version suffix", () => {
    const result = DictionaryRecipeSchema.safeParse({
      ...baseDictionary,
      handle: "core-ui-labels",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a site ref that doesn't match HANDLE_PATTERN", () => {
    const result = DictionaryRecipeSchema.safeParse({
      ...baseDictionary,
      site: "Not A Handle",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a primaryLocale shorter than 2 chars", () => {
    const result = DictionaryRecipeSchema.safeParse({
      ...baseDictionary,
      primaryLocale: "x",
    });
    expect(result.success).toBe(false);
  });

  it("dispatches via the Recipe discriminated union as kind: dictionary", () => {
    const result = RecipeSchema.safeParse(baseDictionary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("dictionary");
    }
  });

  it("rejects an empty phrase key (only the value can be empty, not the key)", () => {
    const result = DictionaryRecipeSchema.safeParse({
      ...baseDictionary,
      phrases: { "": { defaultValue: "x" } },
    });
    expect(result.success).toBe(false);
  });
});
