import { describe, expect, it } from "vitest";
import { articleBylineRecipe } from "../../../example/recipes/article-byline.recipe";
import { articleDesignRecipe } from "../../../example/recipes/article-design.recipe";
import { defaultPageDesignRecipe } from "../../../example/recipes/default-page-design.recipe";
import { landingDesignRecipe } from "../../../example/recipes/landing-design.recipe";
import { standardFooterRecipe } from "../../../example/recipes/standard-footer.recipe";
import { standardHeaderRecipe } from "../../../example/recipes/standard-header.recipe";
import {
  type CompileContext,
  compilePageDesignRecipe,
  compilePartialDesignRecipe,
  compileRecipe,
  compileRecipeSet,
} from "../../../src/recipe/compile";
import {
  contentItemId,
  datasourceId,
  pageDesignId,
  partialDesignId,
  renderingId,
  variantId,
} from "../../../src/recipe/items/guids";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";
import {
  COMPOSITION_FIELDS,
  DEFAULT_DEVICE_ID,
  LAYOUT_FIELDS,
  SITECORE_TEMPLATE_PATHS,
  SITECORE_TEMPLATES,
  SXA_JSON_LAYOUT_ID,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  partialDesignsRoot: "/sitecore/content/Demo/Presentation/Partial Designs",
  pageDesignsRoot: "/sitecore/content/Demo/Presentation/Page Designs",
};

const SITE = "default";

const findCreate = (ops: Operation[], label: string): CreateItemOp =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem" && op.label === label)!;

const findSetField = (ops: Operation[], label: string): SetFieldOp =>
  ops.find((op): op is SetFieldOp => op.op === "SetField" && op.label === label)!;

describe("compilePartialDesignRecipe — standard-header@1", () => {
  const ir = compilePartialDesignRecipe(standardHeaderRecipe, CONTEXT);

  it("emits two ops: CreateItem + SetField(__Renderings) shared layout", () => {
    expect(ir.operations).toHaveLength(2);
  });

  it("writes the layout to __Renderings (Sitecore's SHARED layout), not __Final Renderings", () => {
    const setLayout = findSetField(ir.operations, "partial-design-layout:standard-header@1");
    // A partial design is a reusable, language-independent design artifact, so
    // its layout lives in `__Renderings` — one write every language version of
    // a composing page inherits. Shared field: no language/version.
    expect(setLayout.fieldId).toBe(LAYOUT_FIELDS.RENDERINGS);
    expect(setLayout.language).toBeUndefined();
    expect(setLayout.version).toBeUndefined();
  });

  it("layout XML is the SELF-CONTAINED shared-layout form (renderable standalone in Page Builder)", () => {
    // Byte-identical to a Pages-authored partial design's `__Renderings`
    // (operator-verified 2026-07-17):
    //   <r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{DEVICE}">
    //     <r uid="…" s:ds="…" s:id="…" s:par="…" s:ph="…" /></d></r>
    // Explicit `<d id="{DEVICE}">` device element with anchor-less
    // renderings and NO `<p:da name="l" />` inherit directive. The prior
    // inherit-delta form (device directive + anchors) 500'd the CM layout
    // service when a partial was opened DIRECTLY in Page Builder — no base
    // device layout to merge against — so partials were uneditable
    // standalone.
    const setLayout = findSetField(ir.operations, "partial-design-layout:standard-header@1");
    if (setLayout.value.kind !== "string") throw new Error("expected string");
    const xml = setLayout.value.value;

    expect(xml).toContain('xmlns:p="p"');
    expect(xml).toContain('xmlns:s="s"');
    expect(xml).toContain('p:p="1"');
    // Explicit device element (self-contained; not an inherit-delta).
    expect(xml).toContain(`<d id="{${DEFAULT_DEVICE_ID.toUpperCase()}}">`);
    // NO device-inherit directive — the partial carries its own layout.
    expect(xml).not.toContain('<p:da name="l" />');
    // Anchor-less renderings (document order) — matches the authored form.
    expect(xml).not.toContain("p:before=");
    expect(xml).not.toContain("p:after=");
    // Partial designs do NOT carry the page shared-layout's `<p:da
    // name="xsi" />` root directive (authored partials don't).
    expect(xml).not.toContain('<p:da name="xsi" />');
    // Namespaced attribute names + always-present s:par. Since the
    // flattening pass, EVERY placement carries an item-unique
    // DynamicPlaceholderId rendering parameter, so s:par is never empty.
    expect(xml).toContain("s:ph=");
    expect(xml).toContain("s:ds=");
    expect(xml).toContain("s:id=");
    expect(xml).toMatch(/s:par="[^"]*DynamicPlaceholderId=\d/);
    // Canonical xsd/xsi namespaces must NOT appear in delta form.
    expect(xml).not.toContain("xmlns:xsd");
    expect(xml).not.toContain("xmlns:xsi");
  });

  it("CreateItem points the partial-design item under the partial-designs root with the SXA partial-design template", () => {
    const create = findCreate(ir.operations, "partial-design:standard-header@1");
    expect(create.id).toBe(partialDesignId(SITE, "standard-header@1"));
    expect(create.path).toBe("/sitecore/content/Demo/Presentation/Partial Designs/StandardHeader");
    expect(create.templateOf).toBe(SITECORE_TEMPLATES.PARTIAL_DESIGN);
    expect(create.parent).toEqual({
      kind: "ref-path",
      value: CONTEXT.partialDesignsRoot,
    });
  });

  it("CreateItem carries DisplayName + Icon as initial fields", () => {
    const create = findCreate(ir.operations, "partial-design:standard-header@1");
    const displayName = create.fields.find((f) => f.fieldId === SYSTEM_FIELDS.DISPLAY_NAME);
    expect(displayName?.value).toEqual({ kind: "string", value: "Standard Header" });
  });

  it("SetField(__Renderings) carries the layout XML with all three rendering GUIDs", () => {
    const setLayout = findSetField(ir.operations, "partial-design-layout:standard-header@1");
    expect(setLayout.fieldId).toBe(LAYOUT_FIELDS.RENDERINGS);
    expect(setLayout.value.kind).toBe("string");
    if (setLayout.value.kind === "string") {
      const xml = setLayout.value.value;
      expect(xml).toContain(`{${renderingId(SITE, "site-logo@1").toUpperCase()}}`);
      expect(xml).toContain(`{${renderingId(SITE, "primary-nav@1").toUpperCase()}}`);
      expect(xml).toContain(`{${renderingId(SITE, "utility-nav@1").toUpperCase()}}`);
      // Each rendering's shared content datasource should appear as a `ds=` attribute.
      expect(xml).toContain(`{${contentItemId(SITE, "site-logo-content@1").toUpperCase()}}`);
    }
  });
});

describe("compilePartialDesignRecipe — standard-footer@1 (variant on a placement)", () => {
  const ir = compilePartialDesignRecipe(standardFooterRecipe, CONTEXT);
  const setLayout = findSetField(ir.operations, "partial-design-layout:standard-footer@1");
  const xml = setLayout.value.kind === "string" ? setLayout.value.value : "";

  it("encodes the variant as FieldNames in the par attribute", () => {
    // standard-footer@1 pins variant='icons-only' on footer-social@1.
    expect(xml).toContain("FieldNames=icons-only");
  });
});

describe("compilePartialDesignRecipe — article-byline@1 (no datasource + params)", () => {
  const ir = compilePartialDesignRecipe(articleBylineRecipe, CONTEXT);
  const setLayout = findSetField(ir.operations, "partial-design-layout:article-byline@1");
  const xml = setLayout.value.kind === "string" ? setLayout.value.value : "";

  it("emits a placement with params but no ds attribute for kind: 'none'", () => {
    // author-avatar@1 has params: { Size: "sm" } and datasourceRef: { kind: "none" }
    expect(xml).toContain("Size=sm");
    expect(xml).toContain(`{${renderingId(SITE, "author-avatar@1").toUpperCase()}}`);
  });

  it("emits the shared datasource for author-info@1", () => {
    expect(xml).toContain(`{${contentItemId(SITE, "byline-author-content@1").toUpperCase()}}`);
  });
});

describe("compilePageDesignRecipe — default-page-design@1 (partials only, no own layout)", () => {
  const ir = compilePageDesignRecipe(defaultPageDesignRecipe, CONTEXT);

  it("emits three ops: CreateItem + SetField(PartialDesigns) + SetField(__Renderings shell)", () => {
    // TemplatesMapping is a cross-recipe aggregate — emitted by compileRecipeSet,
    // not compilePageDesignRecipe. See composition-compile-set.test.ts.
    expect(ir.operations).toHaveLength(3);
  });

  it("emits a SetField(__Renderings) device + JSON-layout shell even with no own layout", () => {
    const layoutOp = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "page-design-layout:default-page-design@1"
    );
    expect(layoutOp?.fieldId).toBe(LAYOUT_FIELDS.RENDERINGS);
    if (layoutOp?.value.kind !== "string") throw new Error("expected string");
    const xml = layoutOp.value.value;
    // Bare shell: device + `l="{JSON layout}"`, no rendering elements.
    expect(xml).toContain(`{${SXA_JSON_LAYOUT_ID.toUpperCase()}}`);
    expect(xml).toContain(`{${DEFAULT_DEVICE_ID.toUpperCase()}}`);
    expect(xml).not.toContain("<r id=");
    expect(xml).not.toContain("s:id=");
  });

  it("does NOT emit a per-recipe SetField(TemplatesMapping)", () => {
    const mappingOp = ir.operations.find(
      (op) => op.op === "SetField" && op.label?.startsWith("templates-mapping:")
    );
    expect(mappingOp).toBeUndefined();
  });

  it("CreateItem uses the SXA page-design template and lands under the page-designs root", () => {
    const create = findCreate(ir.operations, "page-design:default-page-design@1");
    expect(create.id).toBe(pageDesignId(SITE, "default-page-design@1"));
    expect(create.templateOf).toBe(SITECORE_TEMPLATES.PAGE_DESIGN);
    expect(create.path).toBe("/sitecore/content/Demo/Presentation/Page Designs/DefaultPageDesign");
  });

  it("SetField(PartialDesigns) carries a ref-recipe-list of partial-design refKeys in render order", () => {
    const setPartials = findSetField(ir.operations, "page-design-partials:default-page-design@1");
    expect(setPartials.fieldId).toBe(COMPOSITION_FIELDS.PARTIAL_DESIGNS);
    expect(setPartials.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [
        partialDesignId(SITE, "standard-header@1"),
        partialDesignId(SITE, "standard-footer@1"),
      ],
    });
  });
});

describe("compilePageDesignRecipe — landing-design@1 (own layout in addition to partials)", () => {
  const ir = compilePageDesignRecipe(landingDesignRecipe, CONTEXT);

  it("emits three ops: CreateItem + PartialDesigns + own __Renderings", () => {
    expect(ir.operations).toHaveLength(3);
  });

  it("emits a SetField(__Renderings) for the design-level cta-banner@1 placement", () => {
    const layout = findSetField(ir.operations, "page-design-layout:landing-design@1");
    expect(layout.fieldId).toBe(LAYOUT_FIELDS.RENDERINGS);
    if (layout.value.kind === "string") {
      expect(layout.value.value).toContain(`{${renderingId(SITE, "cta-banner@1").toUpperCase()}}`);
      expect(layout.value.value).toContain(
        `{${contentItemId(SITE, "landing-cta-content@1").toUpperCase()}}`
      );
    }
  });

  it("page-design layout uses canonical form (NOT delta) — page designs round-trip canonical byte-for-byte", () => {
    const layout = findSetField(ir.operations, "page-design-layout:landing-design@1");
    if (layout.value.kind !== "string") throw new Error("expected string");
    const xml = layout.value.value;
    // Canonical signatures.
    expect(xml).toContain('xmlns:xsd="http://www.w3.org/2001/XMLSchema"');
    expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    // Delta-form signatures must be absent.
    expect(xml).not.toContain('xmlns:p="p"');
    expect(xml).not.toContain("<p:da");
    expect(xml).not.toContain("p:before");
    expect(xml).not.toContain("s:ph");
  });

  it("partials list has only standard-footer@1 (landing skips the header)", () => {
    const partials = findSetField(ir.operations, "page-design-partials:landing-design@1");
    expect(partials.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [partialDesignId(SITE, "standard-footer@1")],
    });
  });
});

describe("compilePageDesignRecipe — article-design@1 (three partials, no own layout)", () => {
  const ir = compilePageDesignRecipe(articleDesignRecipe, CONTEXT);

  it("emits three ops (CreateItem + PartialDesigns + __Renderings shell; templates-mapping is cross-recipe)", () => {
    expect(ir.operations).toHaveLength(3);
  });

  it("PartialDesigns refKeys preserve render order [header, byline, footer]", () => {
    const partials = findSetField(ir.operations, "page-design-partials:article-design@1");
    expect(partials.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [
        partialDesignId(SITE, "standard-header@1"),
        partialDesignId(SITE, "article-byline@1"),
        partialDesignId(SITE, "standard-footer@1"),
      ],
    });
  });
});

describe("compileRecipe dispatcher — composition kinds route correctly", () => {
  it("routes kind: 'partial-design' to compilePartialDesignRecipe", () => {
    const ir = compileRecipe(standardHeaderRecipe, CONTEXT);
    expect(ir.recipeHandle).toBe("standard-header@1");
    expect(ir.operations.some((op) => op.label === "partial-design:standard-header@1")).toBe(true);
  });

  it("routes kind: 'page-design' to compilePageDesignRecipe", () => {
    const ir = compileRecipe(defaultPageDesignRecipe, CONTEXT);
    expect(ir.recipeHandle).toBe("default-page-design@1");
    expect(ir.operations.some((op) => op.label === "page-design:default-page-design@1")).toBe(true);
  });
});

describe("compile compositional recipes — context validation", () => {
  it("throws a clear error when partialDesignsRoot is missing", () => {
    expect(() =>
      compilePartialDesignRecipe(standardHeaderRecipe, {
        templatesRoot: CONTEXT.templatesRoot,
        renderingsRoot: CONTEXT.renderingsRoot,
      })
    ).toThrow(/partialDesignsRoot/);
  });

  it("throws a clear error when pageDesignsRoot is missing", () => {
    expect(() =>
      compilePageDesignRecipe(defaultPageDesignRecipe, {
        templatesRoot: CONTEXT.templatesRoot,
        renderingsRoot: CONTEXT.renderingsRoot,
      })
    ).toThrow(/pageDesignsRoot/);
  });
});

describe("compilePartialDesignRecipe — scoped datasource (partial hosts its own Data item)", () => {
  // A footer sign-off owned by this partial: `scoped` inline content. The
  // partial design item hosts the materialised item at
  // `<partial-design>/Data/LetsSync`; every page using the partial shares it.
  const scopedFooter = {
    kind: "partial-design",
    schemaVersion: "1",
    handle: "scoped-footer@1",
    name: "scoped-footer",
    displayName: "Scoped Footer",
    layout: {
      placeholders: {
        "headless-footer": [
          {
            componentHandle: "tagline-banner@1",
            variant: "Default",
            datasourceRef: {
              kind: "scoped",
              slot: "LetsSync",
              fields: { Tagline: "LET'S SYNC." },
            },
          },
        ],
      },
    },
  } as unknown as Parameters<typeof compilePartialDesignRecipe>[0];

  const ir = compilePartialDesignRecipe(scopedFooter, CONTEXT);
  const partialRefKey = partialDesignId(SITE, "scoped-footer@1");

  it("compiles without rejecting the scoped ref", () => {
    expect(ir.operations.length).toBeGreaterThan(0);
  });

  it("materialises a Data folder (SXA Page Data) under the partial-design item", () => {
    const dataFolder = findCreate(ir.operations, "partial-design-data-folder:scoped-footer@1");
    expect(dataFolder.name).toBe("Data");
    expect(dataFolder.templateOf).toEqual({
      kind: "ref-path",
      value: SITECORE_TEMPLATE_PATHS.SXA_PAGE_DATA,
    });
    expect(dataFolder.parent).toEqual({ kind: "ref-recipe", refKey: partialRefKey });
  });

  it("materialises the slot datasource item at <partial-design>/Data/<slot>", () => {
    const slot = findCreate(ir.operations, "partial-design-datasource:scoped-footer@1:LetsSync");
    expect(slot.name).toBe("LetsSync");
    expect(slot.id).toBe(datasourceId(partialRefKey, "LetsSync"));
  });

  it("writes the inline scoped field value onto the slot item", () => {
    const field = findSetField(
      ir.operations,
      "partial-design-scoped:scoped-footer@1:LetsSync:Tagline"
    );
    expect(field.fieldName).toBe("Tagline");
    expect(field.value).toEqual({ kind: "string", value: "LET'S SYNC." });
  });

  it("references the slot with the page-relative local:/Data/<slot> form (matching UI-authored partials)", () => {
    // A partial design's renderings reference their scoped datasource with the
    // same `local:/Data/<slot>` wire form XM Cloud Pages writes — the items live
    // under the partial design (materialised above), where `local:` resolves
    // for the partial's renderings.
    const setLayout = findSetField(ir.operations, "partial-design-layout:scoped-footer@1");
    const xml = (setLayout.value as { value: string }).value;
    expect(xml).toContain('s:ds="local:/Data/LetsSync"');
    // No absolute-GUID datasource ref.
    expect(xml).not.toContain(`{${datasourceId(partialRefKey, "LetsSync").toUpperCase()}}`);
  });
});

describe("compilePartialDesignRecipe — variant encoding matches pages", () => {
  // Partial/page-design layouts must encode variants + params in the same
  // wire form pages do (variant → Variant Definition GUID via `variantRefFor`),
  // else a design's renderings render with unresolved variants. Regression
  // guard for the shared `layoutEncodingOptions` wiring.
  it("references a declared variant by GUID, an undeclared one by raw name", () => {
    const variantComponent = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "vary-block@1",
      name: "varyblock",
      displayName: "Vary Block",
      fields: [],
      variants: [{ name: "FullBleed" }],
      params: [],
      placedIn: [],
      placeholders: [],
      dynamicPlaceholders: false,
    };
    const partial = {
      kind: "partial-design",
      schemaVersion: "1",
      handle: "variant-partial@1",
      name: "variant-partial",
      displayName: "Variant Partial",
      layout: {
        placeholders: {
          "headless-header": [
            {
              componentHandle: "vary-block@1",
              variant: "FullBleed",
              datasourceRef: { kind: "none" },
            },
            {
              componentHandle: "vary-block@1",
              variant: "Undeclared",
              datasourceRef: { kind: "none" },
            },
          ],
        },
      },
    };
    const irs = compileRecipeSet(
      [variantComponent, partial] as never,
      {
        ...CONTEXT,
        headlessVariantsRoot: "/sitecore/content/Demo/Presentation/Headless Variants",
      } as never
    );
    const partialIr = irs.find((ir) => ir.recipeHandle === "variant-partial@1")!;
    const layout = findSetField(partialIr.operations, "partial-design-layout:variant-partial@1");
    const xml = (layout.value as { value: string }).value;
    // Declared variant → its Variant Definition GUID (same as pages).
    const declaredRef = variantId(SITE, "vary-block@1", "FullBleed").toUpperCase();
    expect(xml).toContain(`FieldNames=${encodeURIComponent(`{${declaredRef}}`)}`);
    // Undeclared variant → raw name (front end matches by export name).
    expect(xml).toContain("FieldNames=Undeclared");
  });
});

describe("compilePageDesignRecipe — scoped datasource (page design hosts its own Data item)", () => {
  const scopedPageDesign = {
    kind: "page-design",
    schemaVersion: "1",
    handle: "scoped-page-design@1",
    name: "scoped-page-design",
    displayName: "Scoped Page Design",
    appliesTo: ["page@1"],
    partials: [],
    layout: {
      placeholders: {
        "headless-main": [
          {
            componentHandle: "tagline-banner@1",
            variant: "Default",
            datasourceRef: {
              kind: "scoped",
              slot: "Hero",
              fields: { Tagline: "WELCOME" },
            },
          },
        ],
      },
    },
  } as unknown as Parameters<typeof compilePageDesignRecipe>[0];

  const ir = compilePageDesignRecipe(scopedPageDesign, CONTEXT);
  const designRefKey = pageDesignId(SITE, "scoped-page-design@1");

  it("materialises the slot item under the page-design item and references it by GUID", () => {
    const slot = findCreate(ir.operations, "page-design-datasource:scoped-page-design@1:Hero");
    expect(slot.id).toBe(datasourceId(designRefKey, "Hero"));
    const setLayout = findSetField(ir.operations, "page-design-layout:scoped-page-design@1");
    const xml = (setLayout.value as { value: string }).value;
    expect(xml).toContain(`{${datasourceId(designRefKey, "Hero").toUpperCase()}}`);
    expect(xml).not.toContain("local:");
  });
});
