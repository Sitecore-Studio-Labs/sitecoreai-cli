import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compilePageDesignRecipe,
  compilePartialDesignRecipe,
} from "../../../src/recipe/compile";
import { contentItemId, partialDesignId, renderingId } from "../../../src/recipe/items/guids";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";
import {
  DEFAULT_DEVICE_ID,
  LAYOUT_FIELDS,
  SXA_JSON_LAYOUT_ID,
} from "../../../src/recipe/ir/sitecore-templates";
import { emitLayoutXml } from "../../../src/recipe/layout/emit";
import type { PageDesignRecipe, PartialDesignRecipe } from "../../../src/recipe/schema/recipe";
import { v5 as uuidv5 } from "../../../src/shared/uuid";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  partialDesignsRoot: "/sitecore/content/Demo/Presentation/Partial Designs",
  pageDesignsRoot: "/sitecore/content/Demo/Presentation/Page Designs",
};

const SITE = "default";

const curly = (guid: string): string => `{${guid.toUpperCase()}}`;

/** Mirrors `placementUid` in `layout/emit.ts` — pins uid determinism. */
const uid = (parentItemId: string, key: string, index: number, handle: string): string =>
  curly(uuidv5(`placement:${key}:${index}:${handle}`, parentItemId));

const findCreate = (ops: Operation[], label: string): CreateItemOp =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem" && op.label === label)!;

const findSetField = (ops: Operation[], label: string): SetFieldOp =>
  ops.find((op): op is SetFieldOp => op.op === "SetField" && op.label === label)!;

const layoutXmlOf = (ops: Operation[], label: string): string => {
  const set = findSetField(ops, label);
  if (set.value.kind !== "string") throw new Error("expected string layout value");
  return set.value.value;
};

/**
 * Mirrors the registry's `footer-legal-strip` stock experience — the
 * exact shape that used to abort a live install with INPUT_INVALID:
 * a placeholder-composed footer shell hosting a column splitter whose
 * columns hold shared-datasource leaves.
 *
 *   headless-footer
 *     └─ footer@1 (kind: none)
 *          footer-main → column-splitter@1 (kind: none)
 *                          column-1 → content-block@1 (shared copyright)
 *                          column-2 → link-list@1 (shared legal links)
 */
const legalStrip = {
  kind: "partial-design",
  schemaVersion: "1",
  handle: "footer-legal-strip@1",
  name: "FooterLegalStrip",
  displayName: "Footer — Legal Strip",
  layout: {
    placeholders: {
      "headless-footer": [
        {
          componentHandle: "footer@1",
          variant: "Default",
          params: { PaddingY: "sm" },
          datasourceRef: { kind: "none" },
          placeholders: {
            "footer-main": [
              {
                componentHandle: "column-splitter@1",
                variant: "Default",
                params: { ColumnCount: "2", MobileColumns: "1" },
                datasourceRef: { kind: "none" },
                placeholders: {
                  "column-1": [
                    {
                      componentHandle: "content-block@1",
                      variant: "Default",
                      datasourceRef: { kind: "shared", handle: "footer-copyright-content@1" },
                    },
                  ],
                  "column-2": [
                    {
                      componentHandle: "link-list@1",
                      variant: "InlineSeparated",
                      datasourceRef: { kind: "shared", handle: "footer-legal-content@1" },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
} satisfies PartialDesignRecipe;

describe("compilePartialDesignRecipe — nested placements (footer shell composition)", () => {
  const ir = compilePartialDesignRecipe(legalStrip, CONTEXT);
  const xml = layoutXmlOf(ir.operations, "partial-design-layout:footer-legal-strip@1");

  it("compiles the shell-composed tree (previously aborted with INPUT_INVALID)", () => {
    // CreateItem + SetField(__Renderings) — no scoped slots in this shape.
    expect(ir.operations).toHaveLength(2);
  });

  it("flattens children into path-qualified dynamic-placeholder keys", () => {
    // footer@1 takes id 1; its footer-main slot becomes the concrete key.
    expect(xml).toContain('s:ph="/headless-footer/footer-main-1"');
    // column-splitter@1 takes id 2; its columns qualify against the
    // parent's already-concrete key — three levels deep.
    expect(xml).toContain('s:ph="/headless-footer/footer-main-1/column-1-2"');
    expect(xml).toContain('s:ph="/headless-footer/footer-main-1/column-2-2"');
  });

  it("assigns every placement an item-unique DynamicPlaceholderId in declaration order", () => {
    expect(xml).toMatch(/s:par="[^"]*PaddingY=sm&amp;DynamicPlaceholderId=1[^"]*"/);
    expect(xml).toMatch(/s:par="[^"]*DynamicPlaceholderId=2[^"]*"/);
    expect(xml).toMatch(/s:par="[^"]*DynamicPlaceholderId=3[^"]*"/);
    expect(xml).toMatch(/s:par="[^"]*DynamicPlaceholderId=4[^"]*"/);
  });

  it("writes the whole flattened tree to the SHARED __Renderings field with the parent", () => {
    const set = findSetField(ir.operations, "partial-design-layout:footer-legal-strip@1");
    // Same field + device as the parent placement — no per-language split.
    expect(set.fieldId).toBe(LAYOUT_FIELDS.RENDERINGS);
    expect(set.language).toBeUndefined();
    expect(set.version).toBeUndefined();
    for (const handle of ["footer@1", "column-splitter@1", "content-block@1", "link-list@1"]) {
      expect(xml).toContain(curly(renderingId(SITE, handle)));
    }
  });

  it("emits the exact self-contained SHARED __Renderings wire form (byte-for-byte)", () => {
    // Self-contained device layout — explicit `<d id="{DEVICE}">`,
    // anchor-less renderings (document order), NO `<p:da name="l" />`
    // inherit directive. Byte-identical in shape to a Pages-authored
    // partial design's `__Renderings` (attribute order uid, s:ds, s:id,
    // s:par, s:ph), so the partial is renderable — and editable —
    // standalone in Page Builder. The prior inherit-delta form 500'd the
    // CM layout service when opened directly.
    const parent = partialDesignId(SITE, "footer-legal-strip@1");
    const expected =
      `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${curly(DEFAULT_DEVICE_ID)}">` +
      `<r uid="${uid(parent, "headless-footer", 0, "footer@1")}"` +
      ` s:id="${curly(renderingId(SITE, "footer@1"))}"` +
      ` s:par="PaddingY=sm&amp;DynamicPlaceholderId=1&amp;FieldNames=Default"` +
      ` s:ph="headless-footer" />` +
      `<r uid="${uid(parent, "/headless-footer/footer-main-1", 0, "column-splitter@1")}"` +
      ` s:id="${curly(renderingId(SITE, "column-splitter@1"))}"` +
      ` s:par="ColumnCount=2&amp;MobileColumns=1&amp;DynamicPlaceholderId=2&amp;FieldNames=Default"` +
      ` s:ph="/headless-footer/footer-main-1" />` +
      `<r uid="${uid(parent, "/headless-footer/footer-main-1/column-1-2", 0, "content-block@1")}"` +
      ` s:ds="${curly(contentItemId(SITE, "footer-copyright-content@1"))}"` +
      ` s:id="${curly(renderingId(SITE, "content-block@1"))}"` +
      ` s:par="DynamicPlaceholderId=3&amp;FieldNames=Default"` +
      ` s:ph="/headless-footer/footer-main-1/column-1-2" />` +
      `<r uid="${uid(parent, "/headless-footer/footer-main-1/column-2-2", 0, "link-list@1")}"` +
      ` s:ds="${curly(contentItemId(SITE, "footer-legal-content@1"))}"` +
      ` s:id="${curly(renderingId(SITE, "link-list@1"))}"` +
      ` s:par="DynamicPlaceholderId=4&amp;FieldNames=InlineSeparated"` +
      ` s:ph="/headless-footer/footer-main-1/column-2-2" />` +
      `</d></r>`;
    expect(xml).toBe(expected);
  });

  it("repeat compiles are byte-identical (deterministic ids + uids)", () => {
    const again = compilePartialDesignRecipe(legalStrip, CONTEXT);
    expect(layoutXmlOf(again.operations, "partial-design-layout:footer-legal-strip@1")).toBe(xml);
  });

  it("respects an author-set DynamicPlaceholderId and skips it when minting", () => {
    const authored = {
      ...legalStrip,
      handle: "footer-authored@1",
      name: "FooterAuthored",
      layout: {
        placeholders: {
          "headless-footer": [
            {
              ...legalStrip.layout.placeholders["headless-footer"][0],
              params: { PaddingY: "sm", DynamicPlaceholderId: "7" },
            },
          ],
        },
      },
    } satisfies PartialDesignRecipe;
    const authoredXml = layoutXmlOf(
      compilePartialDesignRecipe(authored, CONTEXT).operations,
      "partial-design-layout:footer-authored@1"
    );
    // Parent keeps its authored 7; the splitter mints 1 (7 is reserved).
    expect(authoredXml).toContain('s:ph="/headless-footer/footer-main-7"');
    expect(authoredXml).toContain('s:ph="/headless-footer/footer-main-7/column-1-1"');
  });
});

describe("compilePartialDesignRecipe — nested scoped datasource (brand-social shape)", () => {
  // Mirrors the registry's `footer-brand-social` experience: a scoped
  // (partial-local) brand blurb nested two shells deep. Scoped is legal
  // in a partial design — the partial hosts `<partial>/Data/<slot>`
  // itself — and nested children follow the same context rule.
  const brandSocial = {
    kind: "partial-design",
    schemaVersion: "1",
    handle: "footer-brand-social@1",
    name: "FooterBrandSocial",
    displayName: "Footer — Brand + Social",
    layout: {
      placeholders: {
        "headless-footer": [
          {
            componentHandle: "footer@1",
            variant: "TwoTier",
            datasourceRef: { kind: "none" },
            placeholders: {
              "footer-main": [
                {
                  componentHandle: "column-splitter@1",
                  variant: "Default",
                  params: { ColumnCount: "2" },
                  datasourceRef: { kind: "none" },
                  placeholders: {
                    "column-1": [
                      {
                        componentHandle: "content-block@1",
                        variant: "Default",
                        datasourceRef: {
                          kind: "scoped",
                          slot: "BrandBlurb",
                          fields: { Body: "<p>Build, ship, and grow.</p>" },
                        },
                      },
                    ],
                    "column-2": [
                      {
                        componentHandle: "link-list@1",
                        variant: "Horizontal",
                        datasourceRef: { kind: "shared", handle: "footer-social-content@1" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  } satisfies PartialDesignRecipe;

  const ir = compilePartialDesignRecipe(brandSocial, CONTEXT);
  const xml = layoutXmlOf(ir.operations, "partial-design-layout:footer-brand-social@1");

  it("materialises the nested scoped slot at <partial-design>/Data/<slot>", () => {
    const slot = findCreate(
      ir.operations,
      "partial-design-datasource:footer-brand-social@1:BrandBlurb"
    );
    expect(slot.path).toBe(
      "/sitecore/content/Demo/Presentation/Partial Designs/FooterBrandSocial/Data/BrandBlurb"
    );
    const body = findSetField(
      ir.operations,
      "partial-design-scoped:footer-brand-social@1:BrandBlurb:Body"
    );
    expect(body.value).toEqual({ kind: "string", value: "<p>Build, ship, and grow.</p>" });
  });

  it("references the nested scoped slot with the local:/Data/<slot> wire form at its dynamic key", () => {
    expect(xml).toContain('s:ds="local:/Data/BrandBlurb"');
    expect(xml).toContain('s:ph="/headless-footer/footer-main-1/column-1-2"');
  });

  it("keeps shared and scoped siblings side by side in the flattened delta", () => {
    expect(xml).toContain(curly(contentItemId(SITE, "footer-social-content@1")));
    expect(xml).toContain('s:ph="/headless-footer/footer-main-1/column-2-2"');
  });
});

describe("compilePartialDesignRecipe — arbitrary nesting depth", () => {
  it("flattens a four-level tree with one concrete key per level", () => {
    const deep = (levels: number): Record<string, unknown> =>
      levels === 0
        ? {
            componentHandle: "content-block@1",
            datasourceRef: { kind: "shared", handle: "footer-copyright-content@1" },
          }
        : {
            componentHandle: "column-splitter@1",
            datasourceRef: { kind: "none" },
            placeholders: { "column-1": [deep(levels - 1)] },
          };
    const recipe = {
      kind: "partial-design",
      schemaVersion: "1",
      handle: "deep-partial@1",
      name: "DeepPartial",
      displayName: "Deep Partial",
      layout: { placeholders: { "headless-footer": [deep(4)] } },
    } as unknown as PartialDesignRecipe;
    const xml = layoutXmlOf(
      compilePartialDesignRecipe(recipe, CONTEXT).operations,
      "partial-design-layout:deep-partial@1"
    );
    expect(xml).toContain('s:ph="/headless-footer/column-1-1/column-1-2/column-1-3/column-1-4"');
  });
});

describe("compilePageDesignRecipe — nested placements (canonical form)", () => {
  const design = {
    kind: "page-design",
    schemaVersion: "1",
    handle: "nested-design@1",
    name: "NestedDesign",
    displayName: "Nested Design",
    partials: [],
    layout: {
      placeholders: {
        "headless-main": [
          {
            componentHandle: "column-splitter@1",
            variant: "Default",
            datasourceRef: { kind: "none" },
            placeholders: {
              "column-1": [
                {
                  componentHandle: "content-block@1",
                  variant: "Default",
                  datasourceRef: { kind: "shared", handle: "footer-copyright-content@1" },
                },
              ],
            },
          },
        ],
      },
    },
  } satisfies PageDesignRecipe;

  const ir = compilePageDesignRecipe(design, CONTEXT);
  const xml = layoutXmlOf(ir.operations, "page-design-layout:nested-design@1");

  it("flattens children into dynamic keys inside the canonical __Renderings shell", () => {
    // Page designs stay canonical (`ph=`, `l=` shell) — only the tree is
    // flattened, exactly like the page and partial-design compilers.
    expect(xml).toContain(`l="${curly(SXA_JSON_LAYOUT_ID)}"`);
    expect(xml).toContain('ph="headless-main"');
    expect(xml).toContain('ph="/headless-main/column-1-1"');
    expect(xml).toMatch(/par="[^"]*DynamicPlaceholderId=1[^"]*"/);
    expect(xml).toContain(curly(contentItemId(SITE, "footer-copyright-content@1")));
  });
});

describe("emitLayoutXml — layout contexts without a flattening pass", () => {
  const ctx = {
    parentItemId: "07fb9df4-9e7b-5f96-8155-bba2a3ae12f3",
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: (handle: string) => renderingId(SITE, handle),
    contentItemIdFor: (handle: string) => contentItemId(SITE, handle),
    // Content-item version layouts / page-template standard values: no
    // host item for a Data folder, no flattening pass.
    allowScoped: false,
  };

  it("still rejects nested placements loudly (never silently dropped)", () => {
    expect(() =>
      emitLayoutXml(
        {
          placeholders: {
            "headless-main": [
              {
                componentHandle: "footer@1",
                placeholders: {
                  "footer-main": [{ componentHandle: "content-block@1" }],
                },
              },
            ],
          },
        },
        ctx
      )
    ).toThrow(/carries nested placeholders/);
  });

  it("still rejects scoped datasource refs (no host item to resolve against)", () => {
    expect(() =>
      emitLayoutXml(
        {
          placeholders: {
            "headless-main": [
              {
                componentHandle: "content-block@1",
                datasourceRef: { kind: "scoped", slot: "Blurb" },
              },
            ],
          },
        },
        ctx
      )
    ).toThrow(/scoped datasourceRef is invalid/);
  });
});
