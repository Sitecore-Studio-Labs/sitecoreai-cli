import { describe, expect, it } from "vitest";
import { primaryNavContentRecipe } from "../../../example/recipes/primary-nav-content.recipe";
import { siteLogoContentRecipe } from "../../../example/recipes/site-logo-content.recipe";
import {
  type CompileContext,
  compileContentItemRecipe,
  compileRecipe,
} from "../../../src/recipe/compile";
import { contentItemId, fieldId, templateId } from "../../../src/recipe/guids";
import type { ContentFieldValue, ContentItemRecipe } from "../../../src/recipe/schema/recipe";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";
import { SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  contentItemsRoot: "/sitecore/content/Demo/Data",
};

const findCreate = (ops: Operation[]): CreateItemOp =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem")!;

const findSet = (ops: Operation[], fieldName: string, recipeHandle: string): SetFieldOp =>
  ops.find(
    (op): op is SetFieldOp =>
      op.op === "SetField" && op.label === `content-item-field:${recipeHandle}:${fieldName}`
  )!;

const buildRecipe = (
  fields: Record<string, ContentFieldValue>,
  overrides: Partial<ContentItemRecipe> = {}
): ContentItemRecipe => ({
  kind: "content-item",
  schemaVersion: "1",
  handle: "test-content@1",
  name: "TestContent",
  displayName: "Test Content",
  templateType: "test-template@1",
  fields,
  ...overrides,
});

describe("compileContentItemRecipe — IR shape", () => {
  it("emits CreateItem + one SetField per field", () => {
    const ir = compileContentItemRecipe(
      buildRecipe({
        Title: { shape: "text", value: "Hello" },
        Body: { shape: "richText", value: "<p>x</p>" },
      }),
      CONTEXT
    );
    expect(ir.recipeHandle).toBe("test-content@1");
    expect(ir.operations.filter((op) => op.op === "CreateItem")).toHaveLength(1);
    expect(ir.operations.filter((op) => op.op === "SetField")).toHaveLength(2);
  });

  it("CreateItem lands under contentItemsRoot with templateOf set to templateId(templateType)", () => {
    const ir = compileContentItemRecipe(buildRecipe({}), CONTEXT);
    const create = findCreate(ir.operations);
    expect(create.path).toBe("/sitecore/content/Demo/Data/TestContent");
    expect(create.parent).toEqual({ kind: "ref-path", value: CONTEXT.contentItemsRoot });
    expect(create.id).toBe(contentItemId("test-content@1"));
    expect(create.templateOf).toBe(templateId("test-template@1"));
  });

  it("CreateItem carries DisplayName + Icon as initial fields", () => {
    const ir = compileContentItemRecipe(buildRecipe({}), CONTEXT);
    const create = findCreate(ir.operations);
    const display = create.fields.find((f) => f.fieldId === SYSTEM_FIELDS.DISPLAY_NAME);
    expect(display?.value).toEqual({ kind: "string", value: "Test Content" });
  });

  it("SetField targets the field GUID derived from templateType + field name", () => {
    const ir = compileContentItemRecipe(
      buildRecipe({ Title: { shape: "text", value: "Hello" } }),
      CONTEXT
    );
    const setTitle = findSet(ir.operations, "Title", "test-content@1");
    expect(setTitle.fieldId).toBe(fieldId("test-template@1", "Title"));
    expect(setTitle.itemRefKey).toBe(contentItemId("test-content@1"));
  });

  it("throws when contentItemsRoot is missing", () => {
    expect(() =>
      compileContentItemRecipe(buildRecipe({}), {
        templatesRoot: CONTEXT.templatesRoot,
        renderingsRoot: CONTEXT.renderingsRoot,
      })
    ).toThrow(/contentItemsRoot/);
  });
});

describe("compileContentItemRecipe — field encoders", () => {
  const exercise = (field: ContentFieldValue) => {
    const ir = compileContentItemRecipe(buildRecipe({ X: field }), CONTEXT);
    return findSet(ir.operations, "X", "test-content@1").value;
  };

  it("text → kind: 'string' with the literal value", () => {
    expect(exercise({ shape: "text", value: "Hello" })).toEqual({
      kind: "string",
      value: "Hello",
    });
  });

  it("richText → kind: 'string' (HTML preserved)", () => {
    expect(exercise({ shape: "richText", value: "<p>Hi</p>" })).toEqual({
      kind: "string",
      value: "<p>Hi</p>",
    });
  });

  it("boolean → kind: 'bool' (renders as '1' / '0' at apply time)", () => {
    expect(exercise({ shape: "boolean", value: true })).toEqual({
      kind: "bool",
      value: true,
    });
  });

  it("number / integer → kind: 'number'", () => {
    expect(exercise({ shape: "number", value: 3.14 })).toEqual({
      kind: "number",
      value: 3.14,
    });
    expect(exercise({ shape: "integer", value: 42 })).toEqual({
      kind: "number",
      value: 42,
    });
  });

  it("date → Sitecore basic-form yyyyMMddT000000Z (UTC midnight)", () => {
    expect(exercise({ shape: "date", value: "2026-04-30" })).toEqual({
      kind: "string",
      value: "20260430T000000Z",
    });
  });

  it("datetime → Sitecore basic-form yyyyMMddTHHmmssZ in UTC", () => {
    expect(exercise({ shape: "datetime", value: "2026-04-30T15:30:45Z" })).toEqual({
      kind: "string",
      value: "20260430T153045Z",
    });
  });

  it("enum → kind: 'string' with the enum value", () => {
    expect(exercise({ shape: "enum", value: "primary" })).toEqual({
      kind: "string",
      value: "primary",
    });
  });

  it("image → <image mediapath=... /> XML, only present attributes emitted", () => {
    const v = exercise({
      shape: "image",
      mediaPath: "/sitecore/media-library/Logo",
      alt: "Logo",
      width: 160,
      height: 32,
    });
    expect(v.kind).toBe("string");
    if (v.kind !== "string") return;
    expect(v.value).toContain('mediapath="/sitecore/media-library/Logo"');
    expect(v.value).toContain('alt="Logo"');
    expect(v.value).toContain('width="160"');
    expect(v.value).toContain('height="32"');
  });

  it("image XML escapes attribute values containing &, <, \", '", () => {
    const v = exercise({
      shape: "image",
      mediaPath: '/sitecore/media-library/Has "quote" & <tag>',
    });
    if (v.kind !== "string") throw new Error("expected string");
    expect(v.value).toContain("&amp;");
    expect(v.value).toContain("&lt;");
    expect(v.value).toContain("&quot;");
  });

  it('link-external → <link linktype="external" url=... /> XML', () => {
    const v = exercise({
      shape: "link-external",
      href: "https://sitecore.com",
      text: "Sitecore",
      target: "_blank",
    });
    if (v.kind !== "string") throw new Error("expected string");
    expect(v.value).toContain('linktype="external"');
    expect(v.value).toContain('url="https://sitecore.com"');
    expect(v.value).toContain('text="Sitecore"');
    expect(v.value).toContain('target="_blank"');
  });

  it("link-internal throws with a clear deferral message", () => {
    expect(() =>
      compileContentItemRecipe(
        buildRecipe({ X: { shape: "link-internal", ref: "home-page@1", text: "Home" } }),
        CONTEXT
      )
    ).toThrow(/link-internal is deferred/);
  });

  it("reference → kind: 'ref-recipe-list' with refKeys derived via contentItemId", () => {
    expect(exercise({ shape: "reference", refs: ["a@1", "b@1", "c@1"] })).toEqual({
      kind: "ref-recipe-list",
      refKeys: [contentItemId("a@1"), contentItemId("b@1"), contentItemId("c@1")],
    });
  });
});

describe("compileContentItemRecipe — fixture round-trip", () => {
  it("compiles primary-nav-content@1 cleanly (text + reference shapes)", () => {
    const ir = compileContentItemRecipe(primaryNavContentRecipe, CONTEXT);
    expect(ir.recipeHandle).toBe("primary-nav-content@1");
    const create = findCreate(ir.operations);
    expect(create.templateOf).toBe(templateId("primary-nav-template@1"));

    const links = findSet(ir.operations, "Links", "primary-nav-content@1");
    expect(links.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [
        contentItemId("nav-link-products@1"),
        contentItemId("nav-link-pricing@1"),
        contentItemId("nav-link-docs@1"),
      ],
    });
  });

  it("site-logo-content@1 throws because of its link-internal HomeLink (Phase 5+ field)", () => {
    expect(() => compileContentItemRecipe(siteLogoContentRecipe, CONTEXT)).toThrow(
      /link-internal is deferred/
    );
  });
});

describe("compileRecipe dispatcher routes content-item", () => {
  it("compileRecipe(content-item) calls compileContentItemRecipe", () => {
    const ir = compileRecipe(primaryNavContentRecipe, CONTEXT);
    expect(ir.recipeHandle).toBe("primary-nav-content@1");
    expect(ir.operations[0].op).toBe("CreateItem");
  });
});
