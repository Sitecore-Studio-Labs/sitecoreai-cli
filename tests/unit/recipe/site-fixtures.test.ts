import { consola } from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alarisRecipe } from "../../../example/recipes/alaris.recipe";
import { cclBrandTemplateRecipe } from "../../../example/recipes/ccl-brand-template.recipe";
import { solterraCoRecipe } from "../../../example/recipes/solterra-co.recipe";
import {
  type CompileContext,
  compileRecipe,
  compileSiteTemplateRecipe,
} from "../../../src/recipe/compile";
import {
  siteTemplateModuleActionId,
  siteTemplateModuleId,
  templateId,
  thumbnailMediaId,
} from "../../../src/recipe/items/guids";
import type { CreateItemOp, MediaUploadOp, SetFieldOp } from "../../../src/recipe/ir/operations";
import {
  FOUNDATION_SITE_MODULES,
  FOUNDATION_TENANT_MODULES,
  HEADLESS_SITE_SETUP_ROOT,
  SETUP_ACTION_TEMPLATE_PATHS,
  SITECORE_TEMPLATES,
  SITE_TEMPLATE_FIELDS,
  SYSTEM_FIELDS,
  SYSTEM_THUMBNAIL_FIELD_ID,
} from "../../../src/recipe/ir/sitecore-templates";
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

// ---------------------------------------------------------------------------
// Phase 5 Milestone C: compileSiteTemplateRecipe smoke tests.
//
// The compiler emits the SiteTemplate item shell (CreateItem + system
// fields). Structural-metadata SetField ops (page templates list,
// designs list, insert-options matrix, templates-to-designs, dictionary,
// taxonomy) are deferred to Milestone C-extra pending sandbox
// introspection of the SXA SiteTemplate field GUIDs.
// ---------------------------------------------------------------------------

const COMPILE_CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  siteTemplatesRoot: "/sitecore/templates/Project/Demo",
};

const SITE = "default";

const findSet = (ir: ReturnType<typeof compileSiteTemplateRecipe>, label: string): SetFieldOp =>
  ir.operations.find((op): op is SetFieldOp => op.op === "SetField" && op.label === label)!;

describe("compileSiteTemplateRecipe", () => {
  it("emits CreateItem + SetField ops for the SXA Solution-template scalar fields", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe("ccl-brand-template@1");
    // The first op is always the SiteTemplate CreateItem; the four
    // scalar SetField ops (Name, Description, Enabled, Built-in) live
    // adjacent. Module-composition ops follow after — those are
    // exercised by the dedicated tests below.
    expect(ir.operations[0].op).toBe("CreateItem");
    const scalarLabels = new Set([
      "site-template-name:ccl-brand-template@1",
      "site-template-description:ccl-brand-template@1",
      "site-template-enabled:ccl-brand-template@1",
      "site-template-builtin:ccl-brand-template@1",
    ]);
    const scalarOps = ir.operations.filter(
      (op): op is SetFieldOp => op.op === "SetField" && scalarLabels.has(op.label)
    );
    expect(scalarOps).toHaveLength(4);
  });

  it("CreateItem identity uses templateId(handle) — site templates are regular template items", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    expect(create.id).toBe(templateId(SITE, "ccl-brand-template@1"));
  });

  it("CreateItem lands under siteTemplatesRoot at <root>/<recipe.name>", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    expect(create.path).toBe("/sitecore/templates/Project/Demo/ClickClickLaunchBrand");
    expect(create.parent).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/Project/Demo",
    });
  });

  it("CreateItem templateOf is the SXA Solution template GUID (sandbox-verified)", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    expect(create.templateOf).toBe(SITECORE_TEMPLATES.SITE_TEMPLATE);
    // The actual GUID — same one verified via introspection 2026-05-01.
    expect(create.templateOf).toBe("1b2dfd3b-f2f2-4f40-a75c-f6c2490919c4");
  });

  it("CreateItem carries DisplayName + Icon as initial fields", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    const display = create.fields.find((f) => f.fieldId === SYSTEM_FIELDS.DISPLAY_NAME);
    expect(display?.value).toEqual({
      kind: "string",
      value: "Click Click Launch Brand Template",
    });
  });

  it("emits SetField on Solution-template's `Name` field with the recipe's displayName", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const nameOp = findSet(ir, "site-template-name:ccl-brand-template@1");
    expect(nameOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.NAME);
    expect(nameOp.value).toEqual({
      kind: "string",
      value: "Click Click Launch Brand Template",
    });
  });

  it("emits SetField on Description when recipe.description is set", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const descOp = findSet(ir, "site-template-description:ccl-brand-template@1");
    expect(descOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.DESCRIPTION);
    expect(descOp.value.kind).toBe("string");
  });

  it("omits the Description SetField when recipe.description is unset", () => {
    const { description: _omit, ...withoutDesc } = cclBrandTemplateRecipe;
    void _omit;
    const ir = compileSiteTemplateRecipe(withoutDesc, COMPILE_CONTEXT);
    const descOp = ir.operations.find(
      (op) => op.op === "SetField" && op.label.startsWith("site-template-description:")
    );
    expect(descOp).toBeUndefined();
  });

  it("marks the template as Enabled='1' and Built-in='0' (recipe-authored, not SXA-shipped)", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const enabledOp = findSet(ir, "site-template-enabled:ccl-brand-template@1");
    expect(enabledOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.ENABLED);
    expect(enabledOp.value).toEqual({ kind: "string", value: "1" });

    const builtinOp = findSet(ir, "site-template-builtin:ccl-brand-template@1");
    expect(builtinOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.BUILT_IN_TEMPLATE);
    expect(builtinOp.value).toEqual({ kind: "string", value: "0" });
  });

  it("throws a clear error when siteTemplatesRoot is missing", () => {
    expect(() =>
      compileSiteTemplateRecipe(cclBrandTemplateRecipe, {
        templatesRoot: COMPILE_CONTEXT.templatesRoot,
        renderingsRoot: COMPILE_CONTEXT.renderingsRoot,
      })
    ).toThrow(/siteTemplatesRoot/);
  });

  it("compileRecipe dispatcher routes site-template kind to compileSiteTemplateRecipe", () => {
    const ir = compileRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe("ccl-brand-template@1");
    expect(ir.operations[0].op).toBe("CreateItem");
  });

  it("compileRecipe dispatcher routes kind: site through compileSiteRecipe (Milestone E)", () => {
    const ir = compileRecipe(solterraCoRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe(solterraCoRecipe.handle);
    // Phase 5 Milestone E v2: a SiteRecipe compiles to exactly one
    // CreateSiteFromTemplate op followed by N SetField ops (one per
    // dictionary override). Taxonomy emission is still deferred to v3.
    expect(ir.operations[0].op).toBe("CreateSiteFromTemplate");
  });
});

// ---------------------------------------------------------------------------
// Sub-milestone D — Picker UX gap closure.
//
// After D the warn list shrinks to just `image` (per A's U3: the SXA
// Solution template has no separate image source field; the picker
// likely renders __Thumbnail at full resolution). Every other
// schema-accepted-but-was-dropped field now compiles to real ops.
// ---------------------------------------------------------------------------

describe("compileSiteTemplateRecipe — populated-but-dropped warning (post-D)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const MINIMAL_RECIPE = {
    kind: "site-template" as const,
    schemaVersion: "1" as const,
    handle: "minimal-template@1",
    name: "MinimalTemplate",
    displayName: "Minimal Template",
    description: "Only fields the compiler currently surfaces",
  };

  beforeEach(() => {
    warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does NOT warn when only pageTemplates/pageDesigns are populated (now compiled)", () => {
    compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn when thumbnail/contents are populated (now compiled)", () => {
    compileSiteTemplateRecipe(
      {
        ...MINIMAL_RECIPE,
        thumbnail: { kind: "external-url", url: "https://cdn.example.com/thumb.png" },
        contents: [{ name: "Pages", content: "Home" }],
      },
      COMPILE_CONTEXT
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when `image` is populated (still dropped pending E)", () => {
    compileSiteTemplateRecipe(
      {
        ...MINIMAL_RECIPE,
        image: { kind: "external-url", url: "https://cdn.example.com/hero.png" },
      },
      COMPILE_CONTEXT
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain("minimal-template@1");
    expect(message).toContain("image");
    // Other fields shouldn't appear — they're compiled now.
    expect(message).not.toContain("thumbnail");
    expect(message).not.toContain("contents");
    expect(message).not.toContain("pageTemplates");
  });

  it("does NOT warn when the recipe only uses compile-handled fields", () => {
    compileSiteTemplateRecipe(MINIMAL_RECIPE, COMPILE_CONTEXT);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sub-milestone D — thumbnail compile path (G2 picker fields).
// ---------------------------------------------------------------------------

describe("compileSiteTemplateRecipe — thumbnail compilation", () => {
  const BASE = {
    kind: "site-template" as const,
    schemaVersion: "1" as const,
    handle: "thumb-template@1",
    name: "ThumbTemplate",
    displayName: "Thumb Template",
  };

  it("emits MediaUpload + SetField(__Thumbnail) for kind: external-url", () => {
    const ir = compileSiteTemplateRecipe(
      {
        ...BASE,
        thumbnail: {
          kind: "external-url",
          url: "https://cdn.example.com/thumb.png",
          alt: "Brand thumbnail",
        },
      },
      COMPILE_CONTEXT
    );

    const upload = ir.operations.find((op): op is MediaUploadOp => op.op === "MediaUpload");
    expect(upload).toBeDefined();
    expect(upload?.label).toBe("media-upload:thumbnail:thumb-template@1");
    expect(upload?.id).toBe(thumbnailMediaId(SITE, "thumb-template@1"));
    expect(upload?.source).toEqual({
      kind: "external-url",
      url: "https://cdn.example.com/thumb.png",
    });
    expect(upload?.destinationPath).toBe(
      "/sitecore/media library/SiteTemplates/ThumbTemplate/thumb.png"
    );
    expect(upload?.altText).toBe("Brand thumbnail");

    const setThumb = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "site-template-thumbnail:thumb-template@1"
    );
    expect(setThumb).toBeDefined();
    expect(setThumb?.fieldId).toBe(SYSTEM_THUMBNAIL_FIELD_ID);
    expect(setThumb?.value).toEqual({
      kind: "media-xml-ref",
      refKey: thumbnailMediaId(SITE, "thumb-template@1"),
    });
  });

  it("emits MediaUpload + SetField(__Thumbnail) for kind: asset", () => {
    const ir = compileSiteTemplateRecipe(
      {
        ...BASE,
        thumbnail: { kind: "asset", path: "./assets/thumb.png" },
      },
      COMPILE_CONTEXT
    );

    const upload = ir.operations.find((op): op is MediaUploadOp => op.op === "MediaUpload");
    expect(upload).toBeDefined();
    expect(upload?.source).toEqual({ kind: "asset", path: "./assets/thumb.png" });
    expect(upload?.destinationPath).toBe(
      "/sitecore/media library/SiteTemplates/ThumbTemplate/thumb.png"
    );
    // No alt → omitted, not undefined-stamped
    expect(upload?.altText).toBeUndefined();
  });

  it("omits MediaUpload + thumbnail SetField when recipe.thumbnail is unset", () => {
    const ir = compileSiteTemplateRecipe(BASE, COMPILE_CONTEXT);
    expect(ir.operations.find((op) => op.op === "MediaUpload")).toBeUndefined();
    expect(
      ir.operations.find(
        (op) => op.op === "SetField" && op.label.startsWith("site-template-thumbnail:")
      )
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sub-milestone D — contents compile (G2 picker fields).
// ---------------------------------------------------------------------------

describe("compileSiteTemplateRecipe — contents compilation", () => {
  const BASE = {
    kind: "site-template" as const,
    schemaVersion: "1" as const,
    handle: "contents-template@1",
    name: "ContentsTemplate",
    displayName: "Contents Template",
  };

  it("emits SetField(SXA Content) with the JSON-stringified pairs", () => {
    const ir = compileSiteTemplateRecipe(
      {
        ...BASE,
        contents: [
          { name: "Pages", content: "Home, Article Page" },
          { name: "Components", content: "SXA components" },
        ],
      },
      COMPILE_CONTEXT
    );

    const setContents = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "site-template-contents:contents-template@1"
    );
    expect(setContents).toBeDefined();
    expect(setContents?.fieldId).toBe(SITE_TEMPLATE_FIELDS.CONTENT);
    expect(setContents?.value).toEqual({
      kind: "string",
      value: JSON.stringify([
        { name: "Pages", content: "Home, Article Page" },
        { name: "Components", content: "SXA components" },
      ]),
    });
  });

  it("omits SetField(Content) when recipe.contents is unset", () => {
    const ir = compileSiteTemplateRecipe(BASE, COMPILE_CONTEXT);
    expect(
      ir.operations.find(
        (op) => op.op === "SetField" && op.label.startsWith("site-template-contents:")
      )
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sub-milestone D — Module synthesis + SITE_MODULES aggregation (G1).
// ---------------------------------------------------------------------------

describe("compileSiteTemplateRecipe — module synthesis", () => {
  it("synthesises one Module root + AddItem child for a minimal pageTemplates recipe", () => {
    const ir = compileSiteTemplateRecipe(
      {
        kind: "site-template",
        schemaVersion: "1",
        handle: "min-modules@1",
        name: "MinModules",
        displayName: "Min Modules",
        pageTemplates: ["page@1"],
      },
      COMPILE_CONTEXT
    );

    const moduleRefKey = siteTemplateModuleId(SITE, "min-modules@1");
    const moduleCreate = ir.operations.find(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label === "site-template-module:min-modules@1"
    );
    expect(moduleCreate).toBeDefined();
    expect(moduleCreate?.id).toBe(moduleRefKey);
    expect(moduleCreate?.path).toBe("/sitecore/templates/Project/Demo/Modules/MinModules");
    expect(moduleCreate?.parent).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/Project/Demo/Modules",
    });
    expect(moduleCreate?.templateOf).toBe(HEADLESS_SITE_SETUP_ROOT);

    // One action child for pageTemplates[0].
    const actionRefKey = siteTemplateModuleActionId(
      SITE,
      "min-modules@1",
      "add-page-template",
      "page@1"
    );
    const actionCreate = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.id === actionRefKey
    );
    expect(actionCreate).toBeDefined();
    expect(actionCreate?.parent).toEqual({ kind: "ref-recipe", refKey: moduleRefKey });
    expect(actionCreate?.templateOf).toEqual({
      kind: "ref-path",
      value: SETUP_ACTION_TEMPLATE_PATHS.ADD_ITEM,
    });
    // Compiler sanitizes the handle for Sitecore item-name validation
    // (`@` is illegal). `@1` becomes ` v1`.
    expect(actionCreate?.name).toBe("Add page v1");
  });

  it("emits the right action template per source field (AddItem / EditSiteItem / EditTenantTemplate)", () => {
    const ir = compileSiteTemplateRecipe(
      {
        kind: "site-template",
        schemaVersion: "1",
        handle: "mixed-modules@1",
        name: "MixedModules",
        displayName: "Mixed Modules",
        pageTemplates: ["page@1"],
        pageDesigns: ["design@1"],
        insertOptionsMatrix: { "page@1": ["page@1"] },
        templatesToDesigns: { "page@1": "design@1" },
        dictionary: [{ phrase: "Hello", defaultValue: "Hello" }],
        taxonomy: [{ root: "Topics", defaultTags: ["A"] }],
      },
      COMPILE_CONTEXT
    );

    const actionTemplatePathOf = (refKey: string): unknown => {
      const op = ir.operations.find(
        (o): o is CreateItemOp => o.op === "CreateItem" && o.id === refKey
      );
      return op?.templateOf;
    };

    expect(
      actionTemplatePathOf(
        siteTemplateModuleActionId(SITE, "mixed-modules@1", "add-page-template", "page@1")
      )
    ).toEqual({ kind: "ref-path", value: SETUP_ACTION_TEMPLATE_PATHS.ADD_ITEM });
    expect(
      actionTemplatePathOf(
        siteTemplateModuleActionId(SITE, "mixed-modules@1", "add-page-design", "design@1")
      )
    ).toEqual({ kind: "ref-path", value: SETUP_ACTION_TEMPLATE_PATHS.ADD_ITEM });
    expect(
      actionTemplatePathOf(
        siteTemplateModuleActionId(SITE, "mixed-modules@1", "insert-options", "page@1")
      )
    ).toEqual({ kind: "ref-path", value: SETUP_ACTION_TEMPLATE_PATHS.EDIT_SITE_ITEM });
    expect(
      actionTemplatePathOf(
        siteTemplateModuleActionId(SITE, "mixed-modules@1", "templates-to-designs", "page@1")
      )
    ).toEqual({
      kind: "ref-path",
      value: SETUP_ACTION_TEMPLATE_PATHS.EDIT_TENANT_TEMPLATE,
    });
    expect(
      actionTemplatePathOf(
        siteTemplateModuleActionId(SITE, "mixed-modules@1", "dictionary", "Hello")
      )
    ).toEqual({
      kind: "ref-path",
      value: SETUP_ACTION_TEMPLATE_PATHS.EDIT_TENANT_TEMPLATE,
    });
    expect(
      actionTemplatePathOf(
        siteTemplateModuleActionId(SITE, "mixed-modules@1", "taxonomy", "Topics")
      )
    ).toEqual({
      kind: "ref-path",
      value: SETUP_ACTION_TEMPLATE_PATHS.EDIT_TENANT_TEMPLATE,
    });
  });

  it("does NOT synthesise a Module item when none of the source fields are populated", () => {
    const ir = compileSiteTemplateRecipe(
      {
        kind: "site-template",
        schemaVersion: "1",
        handle: "no-modules@1",
        name: "NoModules",
        displayName: "No Modules",
      },
      COMPILE_CONTEXT
    );
    expect(
      ir.operations.find(
        (op) => op.op === "CreateItem" && op.label.startsWith("site-template-module:")
      )
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sub-milestone D — SITE_MODULES / TENANT_MODULES aggregation.
// ---------------------------------------------------------------------------

describe("compileSiteTemplateRecipe — SITE_MODULES / TENANT_MODULES aggregation", () => {
  it("aggregates the 15 Foundation site modules + the synthesised tenant module GUID", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const setSiteModules = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "site-template-site-modules:ccl-brand-template@1"
    );
    expect(setSiteModules).toBeDefined();
    expect(setSiteModules?.fieldId).toBe(SITE_TEMPLATE_FIELDS.SITE_MODULES);
    expect(setSiteModules?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [...FOUNDATION_SITE_MODULES, siteTemplateModuleId(SITE, "ccl-brand-template@1")],
    });
  });

  it("writes only the 15 Foundation site modules when no source fields are populated", () => {
    const ir = compileSiteTemplateRecipe(
      {
        kind: "site-template",
        schemaVersion: "1",
        handle: "bare@1",
        name: "Bare",
        displayName: "Bare",
      },
      COMPILE_CONTEXT
    );
    const setSiteModules = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "site-template-site-modules:bare@1"
    );
    expect(setSiteModules?.value).toEqual({
      kind: "ref-guid-list",
      values: [...FOUNDATION_SITE_MODULES],
    });
  });

  it("writes the 11 Foundation tenant modules verbatim into TENANT_MODULES", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const setTenantModules = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "site-template-tenant-modules:ccl-brand-template@1"
    );
    expect(setTenantModules).toBeDefined();
    expect(setTenantModules?.fieldId).toBe(SITE_TEMPLATE_FIELDS.TENANT_MODULES);
    expect(setTenantModules?.value).toEqual({
      kind: "ref-guid-list",
      values: [...FOUNDATION_TENANT_MODULES],
    });
  });

  it("Foundation site module list has exactly 15 GUIDs (A's U2 capture)", () => {
    expect(FOUNDATION_SITE_MODULES).toHaveLength(15);
  });

  it("Foundation tenant module list has exactly 11 GUIDs (A's U2 capture)", () => {
    expect(FOUNDATION_TENANT_MODULES).toHaveLength(11);
  });
});
