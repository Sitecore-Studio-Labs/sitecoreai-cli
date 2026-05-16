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
          sitecore: { type: "treelist", sourceTypes: ["nonexistent@1"] },
        },
      ],
      variants: [],
      params: [],
    };
    const result = validateRecipeSet([componentWithBadSource]);
    expect(result.unresolvedHandles).toContainEqual({
      fromRecipe: "bad-source@1",
      fromField: "fields.0.sitecore.sourceTypes.0",
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
        "section-definition",
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
