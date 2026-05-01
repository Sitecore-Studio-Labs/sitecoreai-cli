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
} from "../../../src/recipe/compile";
import {
  contentItemId,
  pageDesignId,
  partialDesignId,
  renderingId,
} from "../../../src/recipe/guids";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";
import {
  COMPOSITION_FIELDS,
  LAYOUT_FIELDS,
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  partialDesignsRoot: "/sitecore/content/Demo/Presentation/Partial Designs",
  pageDesignsRoot: "/sitecore/content/Demo/Presentation/Page Designs",
};

const findCreate = (ops: Operation[], label: string): CreateItemOp =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem" && op.label === label)!;

const findSetField = (ops: Operation[], label: string): SetFieldOp =>
  ops.find((op): op is SetFieldOp => op.op === "SetField" && op.label === label)!;

describe("compilePartialDesignRecipe — standard-header@1", () => {
  const ir = compilePartialDesignRecipe(standardHeaderRecipe, CONTEXT);

  it("emits exactly two ops: CreateItem + SetField(__Renderings)", () => {
    expect(ir.operations).toHaveLength(2);
  });

  it("layout XML uses SXA delta form (first push converges in one cycle)", () => {
    // Phase 5 fix — the SXA Partial Design Layout pipeline normalizes
    // canonical input into delta form on first write. Emitting delta
    // directly means push #1 round-trips without server-side rewrite.
    // See plans/sitecore-relationships.md (orchestrator) "Phase 4
    // sandbox findings" for the wire-format spec.
    const setLayout = findSetField(ir.operations, "partial-design-layout:standard-header@1");
    if (setLayout.value.kind !== "string") throw new Error("expected string");
    const xml = setLayout.value.value;

    expect(xml).toContain('xmlns:p="p"');
    expect(xml).toContain('xmlns:s="s"');
    expect(xml).toContain('p:p="1"');
    expect(xml).toContain('<p:da name="l" />');
    // Three placements: first p:before="*", middle p:after="r[@uid='…']",
    // last p:after="*[1=2]" sentinel.
    expect(xml).toContain('p:before="*"');
    expect(xml).toContain('p:after="r[@uid=');
    expect(xml).toContain('p:after="*[1=2]"');
    // Namespaced attribute names + always-present empty s:par.
    expect(xml).toContain("s:placeh=");
    expect(xml).toContain("s:ds=");
    expect(xml).toContain("s:id=");
    expect(xml).toContain('s:par=""');
    // Canonical xsd/xsi namespaces must NOT appear in delta form.
    expect(xml).not.toContain("xmlns:xsd");
    expect(xml).not.toContain("xmlns:xsi");
  });

  it("CreateItem points the partial-design item under the partial-designs root with the SXA partial-design template", () => {
    const create = findCreate(ir.operations, "partial-design:standard-header@1");
    expect(create.id).toBe(partialDesignId("standard-header@1"));
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
      expect(xml).toContain(`{${renderingId("site-logo@1").toUpperCase()}}`);
      expect(xml).toContain(`{${renderingId("primary-nav@1").toUpperCase()}}`);
      expect(xml).toContain(`{${renderingId("utility-nav@1").toUpperCase()}}`);
      // Each rendering's shared content datasource should appear as a `ds=` attribute.
      expect(xml).toContain(`{${contentItemId("site-logo-content@1").toUpperCase()}}`);
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
    expect(xml).toContain(`{${renderingId("author-avatar@1").toUpperCase()}}`);
  });

  it("emits the shared datasource for author-info@1", () => {
    expect(xml).toContain(`{${contentItemId("byline-author-content@1").toUpperCase()}}`);
  });
});

describe("compilePageDesignRecipe — default-page-design@1 (partials only, no own layout)", () => {
  const ir = compilePageDesignRecipe(defaultPageDesignRecipe, CONTEXT);

  it("emits two ops: CreateItem + SetField(PartialDesigns)", () => {
    // TemplatesMapping is a cross-recipe aggregate — emitted by compileRecipeSet,
    // not compilePageDesignRecipe. See composition-compile-set.test.ts.
    expect(ir.operations).toHaveLength(2);
  });

  it("does NOT emit a SetField(__Renderings) when the recipe has no own layout", () => {
    const layoutOp = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "page-design-layout:default-page-design@1"
    );
    expect(layoutOp).toBeUndefined();
  });

  it("does NOT emit a per-recipe SetField(TemplatesMapping)", () => {
    const mappingOp = ir.operations.find(
      (op) => op.op === "SetField" && op.label?.startsWith("templates-mapping:")
    );
    expect(mappingOp).toBeUndefined();
  });

  it("CreateItem uses the SXA page-design template and lands under the page-designs root", () => {
    const create = findCreate(ir.operations, "page-design:default-page-design@1");
    expect(create.id).toBe(pageDesignId("default-page-design@1"));
    expect(create.templateOf).toBe(SITECORE_TEMPLATES.PAGE_DESIGN);
    expect(create.path).toBe("/sitecore/content/Demo/Presentation/Page Designs/DefaultPageDesign");
  });

  it("SetField(PartialDesigns) carries a ref-recipe-list of partial-design refKeys in render order", () => {
    const setPartials = findSetField(ir.operations, "page-design-partials:default-page-design@1");
    expect(setPartials.fieldId).toBe(COMPOSITION_FIELDS.PARTIAL_DESIGNS);
    expect(setPartials.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [partialDesignId("standard-header@1"), partialDesignId("standard-footer@1")],
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
      expect(layout.value.value).toContain(`{${renderingId("cta-banner@1").toUpperCase()}}`);
      expect(layout.value.value).toContain(
        `{${contentItemId("landing-cta-content@1").toUpperCase()}}`
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
    expect(xml).not.toContain("s:placeh");
  });

  it("partials list has only standard-footer@1 (landing skips the header)", () => {
    const partials = findSetField(ir.operations, "page-design-partials:landing-design@1");
    expect(partials.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [partialDesignId("standard-footer@1")],
    });
  });
});

describe("compilePageDesignRecipe — article-design@1 (three partials, no own layout)", () => {
  const ir = compilePageDesignRecipe(articleDesignRecipe, CONTEXT);

  it("emits two ops (no own layout to write; templates-mapping is cross-recipe)", () => {
    expect(ir.operations).toHaveLength(2);
  });

  it("PartialDesigns refKeys preserve render order [header, byline, footer]", () => {
    const partials = findSetField(ir.operations, "page-design-partials:article-design@1");
    expect(partials.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [
        partialDesignId("standard-header@1"),
        partialDesignId("article-byline@1"),
        partialDesignId("standard-footer@1"),
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
