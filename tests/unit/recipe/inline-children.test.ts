/**
 * Inline treelist child materialisation (`compile/inline-children.ts`).
 *
 * A generated page recipe's component datasource commonly carries an
 * inline ARRAY of child-item field maps (a card grid's cards, ranking
 * rows). The compiler must materialise them as REAL child items under
 * the datasource item — conforming to the treelist field's child
 * template (`sitecore.source.types[0]`) — and write the parent field
 * as the children's GUID list. Previously the arrays were silently
 * dropped (`normalizeFieldValue` → null) and every card grid rendered
 * empty.
 */
import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compilePageRecipe,
  compileRecipeSet,
} from "../../../src/recipe/compile";
import {
  datasourceId,
  pageItemId,
  partialDesignId,
  templateId,
} from "../../../src/recipe/items/guids";
import type {
  CreateItemOp,
  MediaUploadOp,
  Operation,
  OperationIr,
  SetFieldOp,
} from "../../../src/recipe/ir/operations";
import type { Recipe } from "../../../src/recipe/schema/recipe";

const SITE = "default";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  pageTemplatesRoot: "/sitecore/templates/Project/Demo",
  pagesRoot: "/sitecore/content/Demo/Home",
  partialDesignsRoot: "/sitecore/content/Demo/Presentation/Partial Designs",
};

const findCreate = (ops: Operation[], label: string): CreateItemOp | undefined =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem" && op.label === label);
const findSetField = (ops: Operation[], label: string): SetFieldOp | undefined =>
  ops.find((op): op is SetFieldOp => op.op === "SetField" && op.label === label);
const opIndex = (ops: Operation[], predicate: (op: Operation) => boolean): number =>
  ops.findIndex(predicate);

const landingPageTemplate = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "landing-page@1",
  name: "LandingPage",
  displayName: "Landing Page",
  fields: [],
} as unknown as Recipe;

/** Inline-`fields:` pattern — the component template IS the datasource template. */
const cardGridComponent = {
  kind: "component-template",
  schemaVersion: "1",
  handle: "card-grid@1",
  name: "CardGrid",
  displayName: "Card Grid",
  fields: [
    { name: "Heading", shape: "text" },
    {
      name: "Cards",
      shape: "reference",
      multiple: true,
      sitecore: { source: { kind: "filter", types: ["card@1"] } },
    },
  ],
} as unknown as Recipe;

const cardContentTemplate = {
  kind: "content-template",
  schemaVersion: "1",
  handle: "card@1",
  name: "Card",
  displayName: "Card",
  fields: [
    { name: "Title", shape: "text" },
    { name: "Image", shape: "image" },
    {
      name: "Bullets",
      shape: "reference",
      multiple: true,
      sitecore: { source: { kind: "filter", types: ["bullet@1"] } },
    },
  ],
} as unknown as Recipe;

const bulletContentTemplate = {
  kind: "content-template",
  schemaVersion: "1",
  handle: "bullet@1",
  name: "Bullet",
  displayName: "Bullet",
  fields: [{ name: "Text", shape: "text" }],
} as unknown as Recipe;

const pageWith = (fields: Record<string, unknown>): Recipe =>
  ({
    kind: "page",
    schemaVersion: "1",
    handle: "home@1",
    name: "Landing",
    displayName: "Landing",
    template: "landing-page@1",
    layout: {
      placeholders: {
        "headless-main": [
          {
            componentHandle: "card-grid@1",
            datasourceRef: { kind: "scoped", slot: "Grid", fields },
          },
        ],
      },
    },
  }) as unknown as Recipe;

const compileSet = (page: Recipe): OperationIr => {
  const irs = compileRecipeSet(
    [landingPageTemplate, cardGridComponent, cardContentTemplate, bulletContentTemplate, page],
    CONTEXT
  );
  const pageIr = irs.find((ir) => ir.recipeHandle === "home@1");
  if (!pageIr) throw new Error("page IR missing from set");
  return pageIr;
};

describe("inline treelist child materialisation — page scoped datasources", () => {
  const page = pageWith({
    Heading: "Top Players",
    Cards: [
      { Title: "One", Image: { src: "https://cdn.example.invalid/one.png", alt: "One" } },
      { Title: "Two" },
    ],
  });

  const pageRef = pageItemId(SITE, "home@1");
  const slotRef = datasourceId(pageRef, "Grid");
  const child0 = datasourceId(slotRef, "Cards[0]");
  const child1 = datasourceId(slotRef, "Cards[1]");

  it("creates one child item per entry under the slot item, conforming to the child template", () => {
    const ops = compileSet(page).operations;

    const first = findCreate(ops, "page-inline:home@1:Cards:1");
    const second = findCreate(ops, "page-inline:home@1:Cards:2");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.id).toBe(child0);
    expect(first!.name).toBe("Cards-1");
    expect(first!.path).toBe("/sitecore/content/Demo/Home/Landing/Data/Grid/Cards-1");
    expect(first!.parent).toEqual({ kind: "ref-recipe", refKey: slotRef });
    expect(first!.templateOf).toBe(templateId(SITE, "card@1"));
    expect(second!.id).toBe(child1);
    expect(second!.path).toBe("/sitecore/content/Demo/Home/Landing/Data/Grid/Cards-2");
  });

  it("sets each child's fields, scoped to the child template", () => {
    const ops = compileSet(page).operations;

    const title = findSetField(ops, "page-inline:home@1:Cards:1:Title");
    expect(title).toBeDefined();
    expect(title!.itemRefKey).toBe(child0);
    expect(title!.fieldName).toBe("Title");
    expect(title!.value).toEqual({ kind: "string", value: "One" });
    expect(title!.language).toBe("en");
    expect(title!.version).toBe(1);

    const title2 = findSetField(ops, "page-inline:home@1:Cards:2:Title");
    expect(title2!.itemRefKey).toBe(child1);
  });

  it("routes child image fields through the MediaUpload ingest path", () => {
    const ops = compileSet(page).operations;

    const image = findSetField(ops, "page-inline:home@1:Cards:1:Image");
    expect(image).toBeDefined();
    expect(image!.value.kind).toBe("media-xml-ref");
    const refKey = (image!.value as { kind: "media-xml-ref"; refKey: string }).refKey;
    const upload = ops.find(
      (op): op is MediaUploadOp => op.op === "MediaUpload" && op.id === refKey
    );
    expect(upload).toBeDefined();
    expect(upload!.source).toEqual({
      kind: "external-url",
      url: "https://cdn.example.invalid/one.png",
    });
    // The upload must precede the referencing SetField so the executor
    // captures the media itemId before resolution.
    expect(opIndex(ops, (op) => op === upload)).toBeLessThan(opIndex(ops, (op) => op === image));
  });

  it("writes the parent treelist field as the children's refKey list, after their creates", () => {
    const ops = compileSet(page).operations;

    const parentField = findSetField(ops, "page-field:home@1:scoped:Grid:Cards");
    expect(parentField).toBeDefined();
    expect(parentField!.itemRefKey).toBe(slotRef);
    expect(parentField!.fieldName).toBe("Cards");
    expect(parentField!.value).toEqual({ kind: "ref-recipe-list", refKeys: [child0, child1] });

    const slotCreateAt = opIndex(ops, (op) => op.op === "CreateItem" && op.id === slotRef);
    const childCreateAt = opIndex(ops, (op) => op.op === "CreateItem" && op.id === child0);
    const parentFieldAt = opIndex(ops, (op) => op === parentField);
    expect(slotCreateAt).toBeGreaterThanOrEqual(0);
    expect(childCreateAt).toBeGreaterThan(slotCreateAt);
    expect(parentFieldAt).toBeGreaterThan(childCreateAt);
  });

  it("still emits plain sibling fields (Heading) alongside the materialised array", () => {
    const ops = compileSet(page).operations;
    const heading = findSetField(ops, "page-field:home@1:scoped:Grid:Heading");
    expect(heading).toBeDefined();
    expect(heading!.value).toEqual({ kind: "string", value: "Top Players" });
  });

  it("recurses into nested arrays (grandchildren under their own child item)", () => {
    const nested = pageWith({
      Cards: [{ Title: "One", Bullets: [{ Text: "a" }, { Text: "b" }] }],
    });
    const ops = compileSet(nested).operations;

    const grand0 = datasourceId(child0, "Bullets[0]");
    const grandCreate = findCreate(ops, "page-inline:home@1:Bullets:1");
    expect(grandCreate).toBeDefined();
    expect(grandCreate!.id).toBe(grand0);
    expect(grandCreate!.parent).toEqual({ kind: "ref-recipe", refKey: child0 });
    expect(grandCreate!.path).toBe(
      "/sitecore/content/Demo/Home/Landing/Data/Grid/Cards-1/Bullets-1"
    );
    expect(grandCreate!.templateOf).toBe(templateId(SITE, "bullet@1"));

    const grandText = findSetField(ops, "page-inline:home@1:Bullets:1:Text");
    expect(grandText).toBeDefined();
    expect(grandText!.value).toEqual({ kind: "string", value: "a" });

    const bulletsField = findSetField(ops, "page-inline:home@1:Cards:1:Bullets");
    expect(bulletsField).toBeDefined();
    expect(bulletsField!.itemRefKey).toBe(child0);
    expect(bulletsField!.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [grand0, datasourceId(child0, "Bullets[1]")],
    });
  });

  it("resolves the child template on an EXTERNAL datasource template (content-template pattern)", () => {
    const rankingComponent = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "ranking@1",
      name: "Ranking",
      displayName: "Ranking",
      datasource: { template: { handle: "ranking-table@1" } },
    } as unknown as Recipe;
    const rankingTable = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "ranking-table@1",
      name: "RankingTable",
      displayName: "Ranking Table",
      fields: [
        {
          name: "Rows",
          shape: "reference",
          multiple: true,
          sitecore: { source: { kind: "filter", types: ["ranking-row@1"] } },
        },
      ],
    } as unknown as Recipe;
    const rankingRow = {
      kind: "content-template",
      schemaVersion: "1",
      handle: "ranking-row@1",
      name: "RankingRow",
      displayName: "Ranking Row",
      fields: [{ name: "Team", shape: "text" }],
    } as unknown as Recipe;
    const page = {
      kind: "page",
      schemaVersion: "1",
      handle: "home@1",
      name: "Landing",
      displayName: "Landing",
      template: "landing-page@1",
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "ranking@1",
              datasourceRef: {
                kind: "scoped",
                slot: "Table",
                fields: { Rows: [{ Team: "Alpha" }] },
              },
            },
          ],
        },
      },
    } as unknown as Recipe;

    const irs = compileRecipeSet(
      [landingPageTemplate, rankingComponent, rankingTable, rankingRow, page],
      CONTEXT
    );
    const ops = irs.find((ir) => ir.recipeHandle === "home@1")!.operations;

    const rowCreate = findCreate(ops, "page-inline:home@1:Rows:1");
    expect(rowCreate).toBeDefined();
    // Child template resolved through the CONTENT template's field defs.
    expect(rowCreate!.templateOf).toBe(templateId(SITE, "ranking-row@1"));
    const team = findSetField(ops, "page-inline:home@1:Rows:1:Team");
    expect(team!.value).toEqual({ kind: "string", value: "Alpha" });
  });

  it("keeps the legacy drop when the child template cannot be resolved", () => {
    const bareComponent = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "mystery@1",
      name: "Mystery",
      displayName: "Mystery",
      fields: [{ name: "Rows", shape: "reference", multiple: true }], // no source.types
    } as unknown as Recipe;
    const page = {
      kind: "page",
      schemaVersion: "1",
      handle: "home@1",
      name: "Landing",
      displayName: "Landing",
      template: "landing-page@1",
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "mystery@1",
              datasourceRef: {
                kind: "scoped",
                slot: "Box",
                fields: { Rows: [{ Team: "Alpha" }] },
              },
            },
          ],
        },
      },
    } as unknown as Recipe;

    const irs = compileRecipeSet([landingPageTemplate, bareComponent, page], CONTEXT);
    const ops = irs.find((ir) => ir.recipeHandle === "home@1")!.operations;

    expect(ops.some((op) => op.label.startsWith("page-inline:"))).toBe(false);
    expect(findSetField(ops, "page-field:home@1:scoped:Box:Rows")).toBeUndefined();
  });

  it("drops arrays on a standalone compile (no cross-recipe maps) without throwing", () => {
    const page = pageWith({ Cards: [{ Title: "One" }] });
    const ir = compilePageRecipe(page as never, CONTEXT);
    expect(ir.operations.some((op) => op.label.startsWith("page-inline:"))).toBe(false);
  });

  it("does not treat arrays of value-shaped objects as child items", () => {
    // Entries carrying `src`/`href`/`shape` are field VALUES, not field
    // maps — no child materialisation, legacy drop.
    const page = pageWith({ Cards: [{ src: "https://x.invalid/a.png" }] });
    const ops = compileSet(page).operations;
    expect(ops.some((op) => op.label.startsWith("page-inline:"))).toBe(false);
  });
});

describe("inline treelist child materialisation — design scoped datasources", () => {
  it("materialises inline children for a partial design's scoped slot", () => {
    const partial = {
      kind: "partial-design",
      schemaVersion: "1",
      handle: "footer@1",
      name: "Footer",
      displayName: "Footer",
      layout: {
        placeholders: {
          "headless-footer": [
            {
              componentHandle: "card-grid@1",
              datasourceRef: {
                kind: "scoped",
                slot: "FooterCards",
                fields: { Cards: [{ Title: "Contact" }] },
              },
            },
          ],
        },
      },
    } as unknown as Recipe;

    const irs = compileRecipeSet(
      [cardGridComponent, cardContentTemplate, bulletContentTemplate, partial],
      CONTEXT
    );
    const ops = irs.find((ir) => ir.recipeHandle === "footer@1")!.operations;

    const partialRef = partialDesignId(SITE, "footer@1");
    const slotRef = datasourceId(partialRef, "FooterCards");
    const childRef = datasourceId(slotRef, "Cards[0]");

    const childCreate = findCreate(ops, "partial-design-inline:footer@1:Cards:1");
    expect(childCreate).toBeDefined();
    expect(childCreate!.id).toBe(childRef);
    expect(childCreate!.parent).toEqual({ kind: "ref-recipe", refKey: slotRef });
    expect(childCreate!.templateOf).toBe(templateId(SITE, "card@1"));

    const parentField = findSetField(ops, "partial-design-scoped:footer@1:FooterCards:Cards");
    expect(parentField).toBeDefined();
    expect(parentField!.value).toEqual({ kind: "ref-recipe-list", refKeys: [childRef] });

    const title = findSetField(ops, "partial-design-inline:footer@1:Cards:1:Title");
    expect(title!.value).toEqual({ kind: "string", value: "Contact" });
  });
});
