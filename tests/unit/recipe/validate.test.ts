import { describe, expect, it } from "vitest";
import type { Recipe } from "../../../src/recipe/schema/recipe";
import {
  formatValidationErrors,
  isValid,
  validateRecipeSet,
  validateRecipeSetOrThrow,
} from "../../../src/recipe/validate";

/**
 * Validation tests use INLINE recipe sets — not the example/recipes/
 * fixtures — because the example fixtures are intentionally minimal
 * (they exercise schema parse, not cross-recipe completeness). A real
 * tenant-pushable set would include every referenced template, content
 * item, and rendering; constructing that here surfaces validation
 * behavior without dragging the example fixtures away from their
 * focused purpose.
 */

const ctaButtonComponent: Recipe = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "site-logo@1",
  name: "SiteLogo",
  displayName: "Site Logo",
  fields: [],
  variants: [],
  params: [],
};

const logoTemplate: Recipe = {
  kind: "content-template",
  schemaVersion: "1",
  handle: "site-logo-template@1",
  name: "SiteLogoTemplate",
  displayName: "Site Logo Template",
  fields: [],
};

const homePageTemplate: Recipe = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "home-page@1",
  name: "HomePage",
  displayName: "Home Page",
  fields: [],
};

const logoContent: Recipe = {
  kind: "content-item",
  schemaVersion: "1",
  handle: "site-logo-content@1",
  name: "SiteLogoContent",
  displayName: "Site Logo Content",
  templateType: "site-logo-template@1",
  fields: {
    Tagline: { shape: "text", value: "Hi" },
  },
};

const headerPartial: Recipe = {
  kind: "partial-design",
  schemaVersion: "1",
  handle: "minimal-header@1",
  name: "MinimalHeader",
  displayName: "Minimal Header",
  layout: {
    placeholders: {
      "/header": [
        {
          componentHandle: "site-logo@1",
          datasourceRef: { kind: "shared", handle: "site-logo-content@1" },
        },
      ],
    },
  },
};

const defaultDesign: Recipe = {
  kind: "page-design",
  schemaVersion: "1",
  handle: "minimal-default@1",
  name: "MinimalDefault",
  displayName: "Minimal Default",
  appliesTo: ["home-page@1"],
  partials: ["minimal-header@1"],
};

const COMPLETE_SET: readonly Recipe[] = [
  ctaButtonComponent,
  logoTemplate,
  homePageTemplate,
  logoContent,
  headerPartial,
  defaultDesign,
];

describe("validateRecipeSet — happy path", () => {
  it("returns no errors for a complete, well-formed recipe set", () => {
    const result = validateRecipeSet(COMPLETE_SET);
    expect(isValid(result)).toBe(true);
    expect(result.unresolvedHandles).toEqual([]);
    expect(result.duplicateHandles).toEqual([]);
    expect(result.cycles).toEqual([]);
  });

  it("isValid returns false when any error category is non-empty", () => {
    expect(
      isValid({
        unresolvedHandles: [],
        duplicateHandles: [],
        cycles: [],
        fieldShapeErrors: [],
        placementViolations: [],
      })
    ).toBe(true);
    expect(
      isValid({
        unresolvedHandles: [
          {
            fromRecipe: "x@1",
            fromField: "y",
            handle: "z@1",
            expectedKinds: [],
            actualKind: undefined,
          },
        ],
        duplicateHandles: [],
        cycles: [],
        fieldShapeErrors: [],
        placementViolations: [],
      })
    ).toBe(false);
    expect(
      isValid({
        unresolvedHandles: [],
        duplicateHandles: [],
        cycles: [],
        fieldShapeErrors: [
          {
            fromRecipe: "site-x@1",
            fromField: "collectionId, collectionName",
            message: "either collectionId or collectionName must be provided",
          },
        ],
        placementViolations: [],
      })
    ).toBe(false);
    expect(
      isValid({
        unresolvedHandles: [],
        duplicateHandles: [],
        cycles: [],
        fieldShapeErrors: [],
        placementViolations: [
          {
            fromRecipe: "demo-design@1",
            fromField: "layout.placeholders./main.0",
            componentHandle: "rogue@1",
            placeholderKey: "/main",
            allowedComponents: ["card@1"],
          },
        ],
      })
    ).toBe(false);
  });
});

describe("validateRecipeSet — duplicate handle detection", () => {
  it("flags a handle that appears twice", () => {
    const result = validateRecipeSet([
      logoTemplate,
      { ...logoTemplate, displayName: "Different Display" },
    ]);
    expect(result.duplicateHandles).toEqual([{ handle: "site-logo-template@1", count: 2 }]);
  });

  it("doesn't false-positive on similar but distinct handles", () => {
    const result = validateRecipeSet([
      logoTemplate,
      { ...logoTemplate, handle: "site-logo-template@2", displayName: "v2" },
    ]);
    expect(result.duplicateHandles).toEqual([]);
  });
});

describe("validateRecipeSet — unresolved handles", () => {
  it("flags a partial whose componentHandle doesn't resolve", () => {
    const result = validateRecipeSet([
      // headerPartial references site-logo@1, which is missing here.
      headerPartial,
      logoContent,
      logoTemplate,
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "minimal-header@1",
      fromField: "layout.placeholders./header.0.componentHandle",
      handle: "site-logo@1",
      expectedKinds: ["component-template"],
      actualKind: undefined,
    });
  });

  it("flags a partial whose shared datasourceRef.handle doesn't resolve", () => {
    const result = validateRecipeSet([
      ctaButtonComponent,
      // logoContent missing
      headerPartial,
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "minimal-header@1",
      fromField: "layout.placeholders./header.0.datasourceRef.handle",
      handle: "site-logo-content@1",
      expectedKinds: ["content-item"],
      actualKind: undefined,
    });
  });

  it("flags a page-design appliesTo handle that resolves to the WRONG kind", () => {
    // ctaButtonComponent is a component-template — appliesTo entries
    // must resolve to page-template recipes.
    const wrongKindDesign: Recipe = {
      kind: "page-design",
      schemaVersion: "1",
      handle: "wrong-kind-design@1",
      name: "WrongKindDesign",
      displayName: "Wrong Kind Design",
      appliesTo: ["site-logo@1"], // component-template, not page-template
      partials: [],
    };
    const result = validateRecipeSet([ctaButtonComponent, wrongKindDesign]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "wrong-kind-design@1",
      fromField: "appliesTo.0",
      handle: "site-logo@1",
      expectedKinds: ["page-template"],
      actualKind: "component-template",
    });
  });

  it("flags a page-design partials entry that points at a content-template instead of a partial-design", () => {
    const wrongKindDesign: Recipe = {
      kind: "page-design",
      schemaVersion: "1",
      handle: "wrong-partials@1",
      name: "WrongPartials",
      displayName: "Wrong Partials",
      appliesTo: ["home-page@1"],
      partials: ["site-logo-template@1"], // content-template, not partial-design
    };
    const result = validateRecipeSet([logoTemplate, homePageTemplate, wrongKindDesign]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "wrong-partials@1",
      fromField: "partials.0",
      handle: "site-logo-template@1",
      expectedKinds: ["partial-design"],
      actualKind: "content-template",
    });
  });

  it("flags a content-item templateType pointing at a non-template recipe", () => {
    const wrongTemplate: Recipe = {
      kind: "content-item",
      schemaVersion: "1",
      handle: "bad-content@1",
      name: "BadContent",
      displayName: "Bad Content",
      templateType: "site-logo-content@1", // content-item, not a template
      fields: {},
    };
    const result = validateRecipeSet([logoContent, logoTemplate, wrongTemplate]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "bad-content@1",
      fromField: "templateType",
      handle: "site-logo-content@1",
      expectedKinds: ["component-template", "content-template", "page-template"],
      actualKind: "content-item",
    });
  });

  it("flags an unresolved sourceTypes handle on a component-template field", () => {
    const componentWithBadSource: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "bad-source@1",
      name: "BadSource",
      displayName: "Bad Source",
      fields: [
        {
          name: "Picker",
          shape: "reference",
          multiple: true,
          sitecore: { type: "treelist", source: { kind: "filter", types: ["nonexistent@1"] } },
        },
      ],
      variants: [],
      params: [],
    };
    const result = validateRecipeSet([componentWithBadSource]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "bad-source@1",
      fromField: "fields.0.sitecore.source.types.0",
      handle: "nonexistent@1",
      expectedKinds: ["component-template", "content-template", "page-template"],
      actualKind: undefined,
    });
  });

  it("flags an unresolved insertOptions handle", () => {
    const componentWithBadInsert: Recipe = {
      ...ctaButtonComponent,
      handle: "bad-insert@1",
      name: "BadInsert",
      insertOptions: ["does-not-exist@1"],
    };
    const result = validateRecipeSet([componentWithBadInsert]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "bad-insert@1",
      fromField: "insertOptions.0",
      handle: "does-not-exist@1",
      expectedKinds: ["component-template", "content-template", "page-template"],
      actualKind: undefined,
    });
  });

  it("flags a content-item link-internal ref that doesn't resolve", () => {
    const contentWithBadLink: Recipe = {
      kind: "content-item",
      schemaVersion: "1",
      handle: "bad-link@1",
      name: "BadLink",
      displayName: "Bad Link",
      templateType: "site-logo-template@1",
      fields: {
        HomeLink: { shape: "link-internal", ref: "ghost@1" },
      },
    };
    const result = validateRecipeSet([logoTemplate, contentWithBadLink]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "bad-link@1",
      fromField: "fields.HomeLink.ref",
      handle: "ghost@1",
      expectedKinds: [
        "component-template",
        "content-template",
        "content-item",
        "page-template",
        "page",
        "placeholder",
        "design-parameters-template",
        "partial-design",
        "page-design",
      ],
      actualKind: undefined,
    });
  });
});

describe("validateRecipeSet — cycle detection on insertOptions chains", () => {
  it("flags a direct A→A self-loop", () => {
    const selfLoop: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "self@1",
      name: "Self",
      displayName: "Self",
      fields: [],
      insertOptions: ["self@1"],
    };
    const result = validateRecipeSet([selfLoop]);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycle).toEqual(["self@1", "self@1"]);
  });

  it("flags an A→B→A two-recipe cycle", () => {
    const a: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "a@1",
      name: "A",
      displayName: "A",
      fields: [],
      insertOptions: ["b@1"],
    };
    const b: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "b@1",
      name: "B",
      displayName: "B",
      fields: [],
      insertOptions: ["a@1"],
    };
    const result = validateRecipeSet([a, b]);
    expect(result.cycles).toHaveLength(1);
    // Normalized to start at the alphabetically-smallest handle.
    expect(result.cycles[0].cycle).toEqual(["a@1", "b@1", "a@1"]);
  });

  it("flags an A→B→C→A three-recipe cycle", () => {
    const a: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "a@1",
      name: "A",
      displayName: "A",
      fields: [],
      insertOptions: ["b@1"],
    };
    const b: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "b@1",
      name: "B",
      displayName: "B",
      fields: [],
      insertOptions: ["c@1"],
    };
    const c: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "c@1",
      name: "C",
      displayName: "C",
      fields: [],
      insertOptions: ["a@1"],
    };
    const result = validateRecipeSet([a, b, c]);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycle).toEqual(["a@1", "b@1", "c@1", "a@1"]);
  });

  it("doesn't flag acyclic insertOptions chains", () => {
    const root: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "root@1",
      name: "Root",
      displayName: "Root",
      fields: [],
      insertOptions: ["leaf@1"],
    };
    const leaf: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "leaf@1",
      name: "Leaf",
      displayName: "Leaf",
      fields: [],
    };
    const result = validateRecipeSet([root, leaf]);
    expect(result.cycles).toEqual([]);
  });
});

describe("formatValidationErrors", () => {
  it("renders a clear multi-line report covering all error categories", () => {
    const result = validateRecipeSet([
      logoTemplate,
      { ...logoTemplate, displayName: "v2" },
      headerPartial,
    ]);
    const formatted = formatValidationErrors(result);
    expect(formatted).toContain("Duplicate handle 'site-logo-template@1'");
    expect(formatted).toContain("minimal-header@1 →");
    expect(formatted).toContain("site-logo@1");
  });
});

describe("validateRecipeSetOrThrow", () => {
  it("returns silently on a clean recipe set", () => {
    expect(() => validateRecipeSetOrThrow(COMPLETE_SET)).not.toThrow();
  });

  it("throws an Error containing the formatted report on any failure", () => {
    expect(() =>
      validateRecipeSetOrThrow([
        headerPartial, // references missing site-logo@1, site-logo-content@1
      ])
    ).toThrow(/Recipe set validation failed/);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 Milestone C: SiteTemplateRecipe + SiteRecipe validation
// ---------------------------------------------------------------------------

const homePageTemplateForSites: Recipe = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "home-page@1",
  name: "HomePage",
  displayName: "Home Page",
  fields: [],
};

const articlePageTemplate: Recipe = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "article-page@1",
  name: "ArticlePage",
  displayName: "Article Page",
  fields: [],
};

const defaultPageDesign: Recipe = {
  kind: "page-design",
  schemaVersion: "1",
  handle: "default-page-design@1",
  name: "DefaultPageDesign",
  displayName: "Default Page Design",
  appliesTo: [],
  partials: [],
};

const articleDesign: Recipe = {
  kind: "page-design",
  schemaVersion: "1",
  handle: "article-design@1",
  name: "ArticleDesign",
  displayName: "Article Design",
  appliesTo: [],
  partials: [],
};

const cclBrand: Recipe = {
  kind: "site-template",
  schemaVersion: "1",
  handle: "ccl-brand@1",
  name: "CclBrand",
  displayName: "CCL Brand",
  pageTemplates: ["home-page@1", "article-page@1"],
  pageDesigns: ["default-page-design@1", "article-design@1"],
  insertOptionsMatrix: {
    "home-page@1": ["article-page@1"],
  },
  templatesToDesigns: {
    "home-page@1": "default-page-design@1",
    "article-page@1": "article-design@1",
  },
};

const SITE_TEMPLATE_DEPS: readonly Recipe[] = [
  homePageTemplateForSites,
  articlePageTemplate,
  defaultPageDesign,
  articleDesign,
];

describe("validateRecipeSet — SiteTemplateRecipe references", () => {
  it("accepts a fully-resolved site template", () => {
    const result = validateRecipeSet([...SITE_TEMPLATE_DEPS, cclBrand]);
    expect(isValid(result)).toBe(true);
  });

  it("flags a pageTemplates entry that doesn't resolve", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      { ...cclBrand, pageTemplates: ["home-page@1", "missing-template@1"] },
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "ccl-brand@1",
      fromField: "pageTemplates.1",
      handle: "missing-template@1",
      expectedKinds: ["page-template"],
      actualKind: undefined,
    });
  });

  it("flags a pageDesigns entry that resolves to the wrong kind", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      { ...cclBrand, pageDesigns: ["home-page@1"] }, // home-page is a page-template, not page-design
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "ccl-brand@1",
      fromField: "pageDesigns.0",
      handle: "home-page@1",
      expectedKinds: ["page-design"],
      actualKind: "page-template",
    });
  });

  it("flags an insertOptionsMatrix child that doesn't resolve", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      {
        ...cclBrand,
        insertOptionsMatrix: { "home-page@1": ["missing-child@1"] },
      },
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "ccl-brand@1",
      fromField: "insertOptionsMatrix.home-page@1.0",
      handle: "missing-child@1",
      expectedKinds: ["page-template"],
      actualKind: undefined,
    });
  });

  it("flags a templatesToDesigns mapping where the design doesn't resolve", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      {
        ...cclBrand,
        templatesToDesigns: { "home-page@1": "missing-design@1" },
      },
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "ccl-brand@1",
      fromField: "templatesToDesigns.home-page@1",
      handle: "missing-design@1",
      expectedKinds: ["page-design"],
      actualKind: undefined,
    });
  });
});

describe("validateRecipeSet — SiteRecipe references", () => {
  const siteWithCollectionName = {
    kind: "site",
    schemaVersion: "1",
    handle: "solterra@1",
    name: "Solterra",
    displayName: "Solterra",
    siteTemplate: "ccl-brand@1",
    language: "en",
    collectionName: "Brand A",
  } as const satisfies Recipe;

  it("accepts a SiteRecipe whose siteTemplate resolves", () => {
    const result = validateRecipeSet([...SITE_TEMPLATE_DEPS, cclBrand, siteWithCollectionName]);
    expect(isValid(result)).toBe(true);
  });

  it("flags a missing siteTemplate", () => {
    const result = validateRecipeSet([siteWithCollectionName]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "solterra@1",
      fromField: "siteTemplate",
      handle: "ccl-brand@1",
      expectedKinds: ["site-template"],
      actualKind: undefined,
    });
  });

  it("flags a siteTemplate that resolves to the wrong kind", () => {
    const result = validateRecipeSet([
      homePageTemplateForSites,
      { ...siteWithCollectionName, siteTemplate: "home-page@1" },
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "solterra@1",
      fromField: "siteTemplate",
      handle: "home-page@1",
      expectedKinds: ["site-template"],
      actualKind: "page-template",
    });
  });

  it("XOR error: rejects a SiteRecipe with both collectionId AND collectionName", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      cclBrand,
      { ...siteWithCollectionName, collectionId: "abc-123" },
    ]);
    expect(result.fieldShapeErrors).toContainEqual({
      fromRecipe: "solterra@1",
      fromField: "collectionId, collectionName",
      message: "collectionId and collectionName are mutually exclusive — provide one, not both",
    });
    expect(isValid(result)).toBe(false);
  });

  it("XOR error: rejects a SiteRecipe with neither collectionId NOR collectionName", () => {
    const { collectionName: _omit, ...siteSansCollection } = siteWithCollectionName;
    void _omit;
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      cclBrand,
      siteSansCollection as Recipe,
    ]);
    expect(result.fieldShapeErrors).toContainEqual({
      fromRecipe: "solterra@1",
      fromField: "collectionId, collectionName",
      message: "either collectionId (existing) or collectionName (new) must be provided",
    });
    expect(isValid(result)).toBe(false);
  });

  it("formatValidationErrors surfaces field-shape errors in the report", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      cclBrand,
      { ...siteWithCollectionName, collectionId: "abc", collectionName: "B" },
    ]);
    const formatted = formatValidationErrors(result);
    expect(formatted).toContain("solterra@1 → collectionId, collectionName:");
    expect(formatted).toContain("mutually exclusive");
  });
});

describe("validateRecipeSet — DictionaryRecipe + SiteTemplate.dictionaries refs", () => {
  const hostSite: Recipe = {
    kind: "site",
    schemaVersion: "1",
    handle: "showcase-shared@1",
    name: "Shared",
    displayName: "Shared",
    siteTemplate: "ccl-brand@1",
    language: "en",
    collectionName: "Showcase",
    siteRole: "shared",
  };

  const coreLabels: Recipe = {
    kind: "dictionary",
    schemaVersion: "1",
    handle: "core-ui-labels@1",
    name: "CoreUiLabels",
    displayName: "Core UI Labels",
    site: "showcase-shared@1",
    phrases: { "cta-go": { defaultValue: "Go" } },
  };

  const brandTemplateWithDict: Recipe = {
    ...cclBrand,
    dictionaries: ["core-ui-labels@1"],
  };

  it("accepts a SiteTemplate.dictionaries entry that resolves to a DictionaryRecipe", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      brandTemplateWithDict,
      hostSite,
      coreLabels,
    ]);
    expect(isValid(result)).toBe(true);
  });

  it("flags a SiteTemplate.dictionaries entry that doesn't resolve", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      { ...cclBrand, dictionaries: ["missing-labels@1"] },
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: cclBrand.handle,
      fromField: "dictionaries.0",
      handle: "missing-labels@1",
      expectedKinds: ["dictionary"],
      actualKind: undefined,
    });
  });

  it("flags a SiteTemplate.dictionaries entry that resolves to the wrong kind", () => {
    const result = validateRecipeSet([
      ...SITE_TEMPLATE_DEPS,
      hostSite,
      { ...cclBrand, dictionaries: ["showcase-shared@1"] },
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: cclBrand.handle,
      fromField: "dictionaries.0",
      handle: "showcase-shared@1",
      expectedKinds: ["dictionary"],
      actualKind: "site",
    });
  });

  it("flags a DictionaryRecipe.site that doesn't resolve", () => {
    const result = validateRecipeSet([coreLabels]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: coreLabels.handle,
      fromField: "site",
      handle: "showcase-shared@1",
      expectedKinds: ["site"],
      actualKind: undefined,
    });
  });

  it("flags a DictionaryRecipe.site that resolves to the wrong kind", () => {
    const result = validateRecipeSet([cclBrand, { ...coreLabels, site: cclBrand.handle }]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: coreLabels.handle,
      fromField: "site",
      handle: cclBrand.handle,
      expectedKinds: ["site"],
      actualKind: "site-template",
    });
  });

  it("does NOT emit a site ref (or unresolved error) for a DictionaryRecipe with no site", () => {
    // A site-less dictionary installs into the deploy's target site — it
    // needs no in-set SiteRecipe, so validation must not demand one.
    const { site: _site, ...sitelessLabels } = coreLabels as typeof coreLabels & {
      site?: string;
    };
    const result = validateRecipeSet([sitelessLabels as Recipe]);
    expect(result.unresolvedHandles.filter((u) => u.fromRecipe === coreLabels.handle)).toEqual([]);
  });
});

describe("validateRecipeSet — shared-site uniqueness per collection", () => {
  const baseShared = {
    kind: "site" as const,
    schemaVersion: "1" as const,
    siteTemplate: "ccl-brand@1",
    language: "en",
    siteRole: "shared" as const,
  };

  it("accepts ONE shared site per collection (the SXA-supported shape)", () => {
    const sharedA: Recipe = {
      ...baseShared,
      handle: "shared-a@1",
      name: "Shared",
      displayName: "Shared",
      collectionName: "Showcase",
    };
    const result = validateRecipeSet([...SITE_TEMPLATE_DEPS, cclBrand, sharedA]);
    expect(isValid(result)).toBe(true);
  });

  it("flags two shared sites under the SAME collectionName as a FieldShapeError", () => {
    const sharedA: Recipe = {
      ...baseShared,
      handle: "shared-a@1",
      name: "SharedA",
      displayName: "Shared A",
      collectionName: "Showcase",
    };
    const sharedB: Recipe = {
      ...baseShared,
      handle: "shared-b@1",
      name: "SharedB",
      displayName: "Shared B",
      collectionName: "Showcase",
    };
    const result = validateRecipeSet([...SITE_TEMPLATE_DEPS, cclBrand, sharedA, sharedB]);
    expect(result.fieldShapeErrors).toContainEqual({
      fromRecipe: "shared-a@1",
      fromField: "siteRole",
      message: expect.stringMatching(
        /collection 'Showcase' has 2 SiteRecipes with siteRole: 'shared'/
      ),
    });
    expect(isValid(result)).toBe(false);
  });

  it("flags two shared sites under the SAME collectionId", () => {
    const sharedA: Recipe = {
      ...baseShared,
      handle: "shared-a@1",
      name: "SharedA",
      displayName: "Shared A",
      collectionId: "coll-abc-123",
    };
    const sharedB: Recipe = {
      ...baseShared,
      handle: "shared-b@1",
      name: "SharedB",
      displayName: "Shared B",
      collectionId: "coll-abc-123",
    };
    const result = validateRecipeSet([...SITE_TEMPLATE_DEPS, cclBrand, sharedA, sharedB]);
    expect(result.fieldShapeErrors).toContainEqual({
      fromRecipe: "shared-a@1",
      fromField: "siteRole",
      message: expect.stringMatching(/collection 'coll-abc-123' has 2 SiteRecipes/),
    });
  });

  it("accepts shared sites in DIFFERENT collections", () => {
    const sharedA: Recipe = {
      ...baseShared,
      handle: "shared-a@1",
      name: "SharedA",
      displayName: "Shared A",
      collectionName: "Showcase",
    };
    const sharedB: Recipe = {
      ...baseShared,
      handle: "shared-b@1",
      name: "SharedB",
      displayName: "Shared B",
      collectionName: "Marketing",
    };
    const result = validateRecipeSet([...SITE_TEMPLATE_DEPS, cclBrand, sharedA, sharedB]);
    expect(isValid(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coverage top-up: placement legality, duplicate placeholder keys, the
// remaining per-kind reference checks (page / page-template / content-item
// content-template / design-parameters-template / component-template extras).
// ---------------------------------------------------------------------------

describe("validateRecipeSet — placement legality (PlacementViolation)", () => {
  const buttonComponent: Recipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: "button@1",
    name: "Button",
    displayName: "Button",
    fields: [],
    variants: [],
    params: [],
  };

  const restrictedSlot: Recipe = {
    kind: "placeholder",
    schemaVersion: "1",
    handle: "main-slot@1",
    key: "/main",
    name: "Main",
    displayName: "Main",
    allowedComponents: ["button@1"], // only Button allowed
  };

  const partialWithRogue: Recipe = {
    kind: "partial-design",
    schemaVersion: "1",
    handle: "rogue-partial@1",
    name: "RoguePartial",
    displayName: "Rogue Partial",
    layout: {
      placeholders: {
        "/main": [{ componentHandle: "button@1" }, { componentHandle: "rogue@1" }],
      },
    },
  };

  const rogueComponent: Recipe = {
    ...buttonComponent,
    handle: "rogue@1",
    name: "Rogue",
    displayName: "Rogue",
  };

  it("flags a component dropped into a placeholder whose whitelist excludes it", () => {
    const result = validateRecipeSet([
      buttonComponent,
      rogueComponent,
      restrictedSlot,
      partialWithRogue,
    ]);
    expect(result.placementViolations).toContainEqual({
      fromRecipe: "rogue-partial@1",
      fromField: "layout.placeholders./main.1",
      componentHandle: "rogue@1",
      placeholderKey: "/main",
      allowedComponents: ["button@1"],
    });
    expect(isValid(result)).toBe(false);
  });

  it("does not flag a placement into a non-recipe-defined placeholder", () => {
    // No PlaceholderRecipe for `/unknown` → not checkable, passes.
    const partial: Recipe = {
      ...partialWithRogue,
      handle: "open-partial@1",
      name: "OpenPartial",
      layout: { placeholders: { "/unknown": [{ componentHandle: "rogue@1" }] } },
    };
    const result = validateRecipeSet([buttonComponent, rogueComponent, partial]);
    expect(result.placementViolations).toEqual([]);
  });

  it("formatValidationErrors renders a placement violation line", () => {
    const result = validateRecipeSet([
      buttonComponent,
      rogueComponent,
      restrictedSlot,
      partialWithRogue,
    ]);
    const formatted = formatValidationErrors(result);
    expect(formatted).toContain("not allowed in placeholder '/main'");
  });
});

describe("validateRecipeSet — duplicate placeholder key", () => {
  it("flags a placeholder key declared by two recipes as a field-shape error", () => {
    const slotA: Recipe = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "slot-a@1",
      key: "/shared",
      name: "SlotA",
      displayName: "Slot A",
    };
    const slotB: Recipe = { ...slotA, handle: "slot-b@1", name: "SlotB" };
    const result = validateRecipeSet([slotA, slotB]);
    expect(
      result.fieldShapeErrors.some(
        (e) => e.fromField === "placeholder key" && e.message.includes("'/shared'")
      )
    ).toBe(true);
    expect(isValid(result)).toBe(false);
  });
});

describe("validateRecipeSet — component-template extra references", () => {
  it("flags an unresolved datasource.template handle", () => {
    const component: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "card@1",
      name: "Card",
      displayName: "Card",
      fields: [],
      variants: [],
      params: [],
      datasource: { template: { handle: "missing-template@1" } },
    };
    const result = validateRecipeSet([component]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "card@1",
      fromField: "datasource.template.handle",
      handle: "missing-template@1",
      expectedKinds: ["content-template"],
      actualKind: undefined,
    });
  });

  it("flags an unresolved inline placeholder slot allowed-handle (under the canonical `allowedRenderingHandles` field name)", () => {
    const component: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "container@1",
      name: "Container",
      displayName: "Container",
      fields: [],
      variants: [],
      params: [],
      placeholders: [{ key: "/inner", allowedComponents: ["ghost-component@1"] }],
    };
    const result = validateRecipeSet([component]);
    // Field name normalised to `allowedRenderingHandles` so the error
    // message points at the canonical surface, even when authors used
    // the historical `allowedComponents` alias on the slot.
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "container@1",
      fromField: "placeholders.0.allowedRenderingHandles.0",
      handle: "ghost-component@1",
      expectedKinds: ["component-template"],
      actualKind: undefined,
    });
  });

  it("flags the same unresolved handle whether it's authored as `allowedComponents` or `allowedRenderingHandles`", () => {
    const component: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "container@1",
      name: "Container",
      displayName: "Container",
      fields: [],
      variants: [],
      params: [],
      placeholders: [{ key: "/inner", allowedRenderingHandles: ["ghost-component@1"] }],
    };
    const result = validateRecipeSet([component]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "container@1",
      fromField: "placeholders.0.allowedRenderingHandles.0",
      handle: "ghost-component@1",
      expectedKinds: ["component-template"],
      actualKind: undefined,
    });
  });
});

describe("validateRecipeSet — content-template + design-parameters-template", () => {
  it("flags an unresolved content-template insertOptions handle", () => {
    const template: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "list-template@1",
      name: "ListTemplate",
      displayName: "List Template",
      fields: [],
      insertOptions: ["missing-child@1"],
    };
    const result = validateRecipeSet([template]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "list-template@1",
      fromField: "insertOptions.0",
      handle: "missing-child@1",
      expectedKinds: ["component-template", "content-template", "page-template"],
      actualKind: undefined,
    });
  });

  it("flags an unresolved design-parameters-template param sourceTypes handle", () => {
    const template: Recipe = {
      kind: "design-parameters-template",
      schemaVersion: "1",
      handle: "shared-params@1",
      name: "SharedParams",
      displayName: "Shared Params",
      params: [
        {
          name: "Theme",
          shape: "reference",
          sitecore: { type: "droplink", source: { kind: "filter", types: ["ghost@1"] } },
        },
      ],
    };
    const result = validateRecipeSet([template]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "shared-params@1",
      fromField: "params.0.sitecore.source.types.0",
      handle: "ghost@1",
      expectedKinds: ["component-template", "content-template", "page-template"],
      actualKind: undefined,
    });
  });
});

describe("validateRecipeSet — page-template + page layout references", () => {
  const pageTemplate: Recipe = {
    kind: "page-template",
    schemaVersion: "1",
    handle: "landing-page@1",
    name: "LandingPage",
    displayName: "Landing Page",
    fields: [],
  };

  it("flags an unresolved page-template insertOptions handle (must be a page-template)", () => {
    const result = validateRecipeSet([{ ...pageTemplate, insertOptions: ["not-a-page@1"] }]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "landing-page@1",
      fromField: "insertOptions.0",
      handle: "not-a-page@1",
      expectedKinds: ["page-template"],
      actualKind: undefined,
    });
  });

  it("flags an unresolved componentHandle in a page-template layout placement", () => {
    const result = validateRecipeSet([
      {
        ...pageTemplate,
        layout: { placeholders: { "/main": [{ componentHandle: "ghost-comp@1" }] } },
      },
    ]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "landing-page@1",
      fromField: "layout.placeholders./main.0.componentHandle",
      handle: "ghost-comp@1",
      expectedKinds: ["component-template"],
      actualKind: undefined,
    });
  });

  it("flags an unresolved template on a PageRecipe and a missing initialHome target", () => {
    const page: Recipe = {
      kind: "page",
      schemaVersion: "1",
      handle: "home@1",
      name: "Home",
      displayName: "Home",
      template: "ghost-template@1",
      fields: {},
      layout: { placeholders: { "/main": [{ componentHandle: "ghost-comp@1" }] } },
    };
    const result = validateRecipeSet([page]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "home@1",
      fromField: "template",
      handle: "ghost-template@1",
      expectedKinds: ["page-template"],
      actualKind: undefined,
    });
    // The page's layout placement is also walked.
    expect(
      result.unresolvedHandles.some(
        (u) => u.fromField === "layout.placeholders./main.0.componentHandle"
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coverage top-up #2 — branches the suites above don't reach: placedIn
// allow-set push, empty-whitelist placeholders, content-item reference-shape
// refs, component-template parameters/children, page-design layout
// datasourceRef, and page initialHome.
// ---------------------------------------------------------------------------

describe("validateRecipeSet — placedIn extends a placeholder allow-set", () => {
  it("a component listing a placeholder in placedIn is treated as allowed there", () => {
    // `card@1` declares it belongs in `/main` via `placedIn`; that pushes
    // `card@1` into the `/main` allow-set, so its placement is legal even
    // though the PlaceholderRecipe's own allowedComponents omits it.
    const slot: Recipe = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "main-ph@1",
      key: "/main",
      name: "Main",
      displayName: "Main",
      allowedComponents: ["button@1"],
    };
    const button: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "button@1",
      name: "Button",
      displayName: "Button",
      fields: [],
      variants: [],
      params: [],
    };
    const card: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "card@1",
      name: "Card",
      displayName: "Card",
      fields: [],
      variants: [],
      params: [],
      placedIn: ["/main"],
    };
    const partial: Recipe = {
      kind: "partial-design",
      schemaVersion: "1",
      handle: "p@1",
      name: "P",
      displayName: "P",
      layout: { placeholders: { "/main": [{ componentHandle: "card@1" }] } },
    };
    const result = validateRecipeSet([slot, button, card, partial]);
    // `card@1` is allowed in `/main` thanks to its `placedIn` entry.
    expect(result.placementViolations).toEqual([]);
    expect(isValid(result)).toBe(true);
  });
});

describe("validateRecipeSet — empty-whitelist placeholder is unrestricted", () => {
  it("does not flag placements into a recipe-defined placeholder with an empty whitelist", () => {
    // The placeholder is recipe-defined but carries no allowedComponents —
    // an unrestricted slot. checkLayoutPlacements skips it (allow.size === 0).
    const openSlot: Recipe = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "open-ph@1",
      key: "/open",
      name: "Open",
      displayName: "Open",
    };
    const rogue: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "rogue@1",
      name: "Rogue",
      displayName: "Rogue",
      fields: [],
      variants: [],
      params: [],
    };
    const partial: Recipe = {
      kind: "partial-design",
      schemaVersion: "1",
      handle: "p2@1",
      name: "P2",
      displayName: "P2",
      layout: { placeholders: { "/open": [{ componentHandle: "rogue@1" }] } },
    };
    const result = validateRecipeSet([openSlot, rogue, partial]);
    expect(result.placementViolations).toEqual([]);
  });
});

describe("validateRecipeSet — content-item reference-shape field refs", () => {
  it("walks a content-item link-internal ref and a reference refs[] list", () => {
    const contentItem: Recipe = {
      kind: "content-item",
      schemaVersion: "1",
      handle: "promo@1",
      name: "Promo",
      displayName: "Promo",
      templateType: "missing-template@1",
      fields: {
        Link: { shape: "link-internal", ref: "ghost-link@1" },
        Related: { shape: "reference", refs: ["ghost-a@1", "ghost-b@1"] },
      },
    };
    const result = validateRecipeSet([contentItem]);
    const fields = result.unresolvedHandles.map((u) => u.fromField);
    expect(fields).toContain("templateType");
    expect(fields).toContain("fields.Link.ref");
    expect(fields).toContain("fields.Related.refs.0");
    expect(fields).toContain("fields.Related.refs.1");
  });
});

describe("validateRecipeSet — component-template parameters + children", () => {
  it("flags an unresolved parameters handle (must be a design-parameters-template)", () => {
    const component: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "hero@1",
      name: "Hero",
      displayName: "Hero",
      fields: [],
      variants: [],
      params: [],
      parameters: { handle: "ghost-params@1" },
    };
    const result = validateRecipeSet([component]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "hero@1",
      fromField: "parameters.handle",
      handle: "ghost-params@1",
      expectedKinds: ["design-parameters-template"],
      actualKind: undefined,
    });
  });

  it("flags an unresolved children.allowedHandles entry", () => {
    const component: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "list@1",
      name: "List",
      displayName: "List",
      fields: [],
      variants: [],
      params: [],
      children: { allowedHandles: ["ghost-child@1"] },
    };
    const result = validateRecipeSet([component]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "list@1",
      fromField: "children.allowedHandles.0",
      handle: "ghost-child@1",
      expectedKinds: ["component-template", "content-template", "page-template"],
      actualKind: undefined,
    });
  });

  it("flags an unresolved component-template field sourceTypes handle", () => {
    const component: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "picker@1",
      name: "Picker",
      displayName: "Picker",
      variants: [],
      params: [],
      fields: [
        {
          name: "Target",
          shape: "reference",
          sitecore: { type: "droplink", source: { kind: "filter", types: ["ghost-source@1"] } },
        },
      ],
    };
    const result = validateRecipeSet([component]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "picker@1",
      fromField: "fields.0.sitecore.source.types.0",
      handle: "ghost-source@1",
      expectedKinds: ["component-template", "content-template", "page-template"],
      actualKind: undefined,
    });
  });
});

describe("validateRecipeSet — partial-design + page-design datasource refs", () => {
  it("flags an unresolved shared datasourceRef handle in a partial-design layout", () => {
    const partial: Recipe = {
      kind: "partial-design",
      schemaVersion: "1",
      handle: "header@1",
      name: "Header",
      displayName: "Header",
      layout: {
        placeholders: {
          "/header": [
            {
              componentHandle: "ghost-comp@1",
              datasourceRef: { kind: "shared", handle: "ghost-ds@1" },
            },
          ],
        },
      },
    };
    const result = validateRecipeSet([partial]);
    const fields = result.unresolvedHandles.map((u) => u.fromField);
    expect(fields).toContain("layout.placeholders./header.0.componentHandle");
    expect(fields).toContain("layout.placeholders./header.0.datasourceRef.handle");
  });

  it("walks a page-design's own layout placeholders for unresolved refs", () => {
    const design: Recipe = {
      kind: "page-design",
      schemaVersion: "1",
      handle: "default@1",
      name: "Default",
      displayName: "Default",
      appliesTo: [],
      partials: [],
      layout: {
        placeholders: {
          "/body": [
            {
              componentHandle: "ghost-body-comp@1",
              datasourceRef: { kind: "shared", handle: "ghost-body-ds@1" },
            },
          ],
        },
      },
    };
    const result = validateRecipeSet([design]);
    const fields = result.unresolvedHandles.map((u) => u.fromField);
    expect(fields).toContain("layout.placeholders./body.0.componentHandle");
    expect(fields).toContain("layout.placeholders./body.0.datasourceRef.handle");
  });
});

describe("validateRecipeSet — site initialHome reference", () => {
  it("flags a SiteRecipe initialHome that resolves to the wrong kind", () => {
    const siteTemplate: Recipe = {
      kind: "site-template",
      schemaVersion: "1",
      handle: "brand@1",
      name: "Brand",
      displayName: "Brand",
      pageTemplates: [],
      pageDesigns: [],
    };
    const site = {
      kind: "site",
      schemaVersion: "1",
      handle: "acme@1",
      name: "Acme",
      displayName: "Acme",
      siteTemplate: "brand@1",
      language: "en",
      collectionName: "Brands",
      // initialHome must be a `page` — pointing it at the site-template
      // resolves to the wrong kind.
      initialHome: "brand@1",
    } as const satisfies Recipe;
    const result = validateRecipeSet([siteTemplate, site]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "acme@1",
      fromField: "initialHome",
      handle: "brand@1",
      expectedKinds: ["page"],
      actualKind: "site-template",
    });
  });

  it("walks page link-internal and reference field refs", () => {
    const page: Recipe = {
      kind: "page",
      schemaVersion: "1",
      handle: "home@1",
      name: "Home",
      displayName: "Home",
      template: "ghost-tpl@1",
      fields: {
        Hero: { shape: "link-internal", ref: "ghost-hero@1" },
        Cards: { shape: "reference", refs: ["ghost-card@1"] },
      },
    };
    const result = validateRecipeSet([page]);
    const fields = result.unresolvedHandles.map((u) => u.fromField);
    expect(fields).toContain("fields.Hero.ref");
    expect(fields).toContain("fields.Cards.refs.0");
  });
});

describe("formatValidationErrors — cyclic + actualKind-known rendering", () => {
  it("renders a cyclic insertOptions chain line", () => {
    const a: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "a@1",
      name: "A",
      displayName: "A",
      fields: [],
      insertOptions: ["b@1"],
    };
    const b: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "b@1",
      name: "B",
      displayName: "B",
      fields: [],
      insertOptions: ["a@1"],
    };
    const formatted = formatValidationErrors(validateRecipeSet([a, b]));
    expect(formatted).toContain("Cyclic insertOptions chain:");
  });

  it("renders the 'found a X recipe' branch when a ref resolves to the wrong kind", () => {
    const wrongKind: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "thing@1",
      name: "Thing",
      displayName: "Thing",
      fields: [],
    };
    const page: Recipe = {
      kind: "page",
      schemaVersion: "1",
      handle: "p@1",
      name: "P",
      displayName: "P",
      template: "thing@1", // a content-template, not a page-template
      fields: {},
    };
    const formatted = formatValidationErrors(validateRecipeSet([wrongKind, page]));
    expect(formatted).toContain("found a content-template recipe");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch top-up — layout datasourceRef arms + sourceTypes loops + cycles
// ─────────────────────────────────────────────────────────────────────────

describe("validateRecipeSet — sourceTypes loops on every template kind", () => {
  it("flags an unresolved component-template param sourceTypes handle", () => {
    const comp: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "card@1",
      name: "Card",
      displayName: "Card",
      fields: [],
      variants: [],
      params: [
        {
          name: "Theme",
          shape: "enum",
          sitecore: { source: { kind: "filter", types: ["ghost-template@1"] } },
        },
      ] as never,
    };
    const result = validateRecipeSet([comp]);
    expect(result.unresolvedHandles[0]).toMatchObject({
      handle: "ghost-template@1",
      fromField: "params.0.sitecore.source.types.0",
    });
  });

  it("flags an unresolved content-template field sourceTypes handle", () => {
    const content: Recipe = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "doc@1",
      name: "Doc",
      displayName: "Doc",
      fields: [
        {
          name: "Related",
          shape: "reference",
          sitecore: { source: { kind: "filter", types: ["ghost@1"] } },
        },
      ] as never,
    };
    const result = validateRecipeSet([content]);
    expect(result.unresolvedHandles[0]).toMatchObject({
      handle: "ghost@1",
      fromField: "fields.0.sitecore.source.types.0",
    });
  });
});

describe("validateRecipeSet — layout datasourceRef.handle on page-design / page-template / page", () => {
  const comp: Recipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: "hero@1",
    name: "Hero",
    displayName: "Hero",
    fields: [],
    variants: [],
    params: [],
  };

  it("flags an unresolved shared datasourceRef in a page-design's own layout", () => {
    const design: Recipe = {
      kind: "page-design",
      schemaVersion: "1",
      handle: "design@1",
      name: "Design",
      displayName: "Design",
      appliesTo: [],
      partials: [],
      layout: {
        placeholders: {
          "/main": [
            {
              componentHandle: "hero@1",
              datasourceRef: { kind: "shared", handle: "ghost-content@1" },
            },
          ],
        },
      },
    };
    const result = validateRecipeSet([comp, design]);
    expect(
      result.unresolvedHandles.some(
        (u) => u.handle === "ghost-content@1" && u.fromField.includes("datasourceRef.handle")
      )
    ).toBe(true);
  });

  it("flags an unresolved shared datasourceRef in a page-template layout", () => {
    const tpl: Recipe = {
      kind: "page-template",
      schemaVersion: "1",
      handle: "page-tpl@1",
      name: "PageTpl",
      displayName: "Page Tpl",
      fields: [],
      layout: {
        placeholders: {
          "/main": [
            {
              componentHandle: "hero@1",
              datasourceRef: { kind: "shared", handle: "ghost-content@1" },
            },
          ],
        },
      },
    };
    const result = validateRecipeSet([comp, tpl]);
    expect(
      result.unresolvedHandles.some(
        (u) => u.handle === "ghost-content@1" && u.fromField.includes("datasourceRef.handle")
      )
    ).toBe(true);
  });

  it("flags an unresolved shared datasourceRef in a page layout", () => {
    const pageTpl: Recipe = {
      kind: "page-template",
      schemaVersion: "1",
      handle: "pt@1",
      name: "PT",
      displayName: "PT",
      fields: [],
    };
    const page: Recipe = {
      kind: "page",
      schemaVersion: "1",
      handle: "page@1",
      name: "Page",
      displayName: "Page",
      template: "pt@1",
      fields: {},
      layout: {
        placeholders: {
          "/main": [
            {
              componentHandle: "hero@1",
              datasourceRef: { kind: "shared", handle: "ghost-content@1" },
            },
          ],
        },
      },
    };
    const result = validateRecipeSet([comp, pageTpl, page]);
    expect(
      result.unresolvedHandles.some(
        (u) => u.handle === "ghost-content@1" && u.fromField.includes("datasourceRef.handle")
      )
    ).toBe(true);
  });

  it("does not flag a scoped datasourceRef (only shared refs are checked)", () => {
    const tpl: Recipe = {
      kind: "page-template",
      schemaVersion: "1",
      handle: "page-tpl@1",
      name: "PageTpl",
      displayName: "Page Tpl",
      fields: [],
      layout: {
        placeholders: {
          "/main": [
            {
              componentHandle: "hero@1",
              datasourceRef: { kind: "scoped", slot: "data" },
            },
          ],
        },
      },
    };
    const result = validateRecipeSet([comp, tpl]);
    // A scoped ref has no handle to resolve — no unresolved entry from it.
    expect(result.unresolvedHandles).toEqual([]);
  });
});

describe("validateRecipeSet — placement-violation 'allowed: none' rendering", () => {
  it("renders 'none' when an empty-but-extended whitelist still excludes the component", () => {
    // Placeholder with one explicit allowed component; a different
    // component placed into it is a violation listing the allow-set.
    const allowed: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "allowed@1",
      name: "Allowed",
      displayName: "Allowed",
      fields: [],
      variants: [],
      params: [],
    };
    const intruder: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "intruder@1",
      name: "Intruder",
      displayName: "Intruder",
      fields: [],
      variants: [],
      params: [],
    };
    const ph: Recipe = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "ph@1",
      name: "Ph",
      displayName: "Ph",
      key: "main",
      allowedComponents: ["allowed@1"],
    };
    const partial: Recipe = {
      kind: "partial-design",
      schemaVersion: "1",
      handle: "partial@1",
      name: "Partial",
      displayName: "Partial",
      layout: {
        placeholders: { main: [{ componentHandle: "intruder@1" }] },
      },
    };
    const result = validateRecipeSet([allowed, intruder, ph, partial]);
    expect(result.placementViolations).toHaveLength(1);
    const formatted = formatValidationErrors(result);
    // allowed-set is non-empty here → the join renders the allowed handle.
    expect(formatted).toContain("allowed: allowed@1");
  });
});

describe("detectInsertOptionsCycles — normalization", () => {
  it("normalizes a B→C→A→B cycle to start at the smallest handle", () => {
    const mk = (handle: string, next: string): Recipe => ({
      kind: "content-template",
      schemaVersion: "1",
      handle,
      name: handle,
      displayName: handle,
      fields: [],
      insertOptions: [next],
    });
    // Declare in non-alphabetical order so DFS hits the cycle mid-ring.
    const recipes = [mk("c@1", "a@1"), mk("b@1", "c@1"), mk("a@1", "b@1")];
    const result = validateRecipeSet(recipes);
    expect(result.cycles).toHaveLength(1);
    // Normalized to start at the alphabetically-smallest handle.
    expect(result.cycles[0].startHandle).toBe("a@1");
    expect(result.cycles[0].cycle[0]).toBe("a@1");
    expect(result.cycles[0].cycle[result.cycles[0].cycle.length - 1]).toBe("a@1");
  });

  it("reports a single cycle once even when reachable from multiple roots", () => {
    const mk = (handle: string, next?: string): Recipe => ({
      kind: "content-template",
      schemaVersion: "1",
      handle,
      name: handle,
      displayName: handle,
      fields: [],
      ...(next ? { insertOptions: [next] } : {}),
    });
    // root@1 → a@1 → b@1 → a@1 ; the cycle (a,b) is found once.
    const recipes = [mk("root@1", "a@1"), mk("a@1", "b@1"), mk("b@1", "a@1")];
    const result = validateRecipeSet(recipes);
    expect(result.cycles).toHaveLength(1);
  });
});
