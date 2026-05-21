import { describe, expect, it } from "vitest";
import { primaryNavContentRecipe } from "../../../example/recipes/primary-nav-content.recipe";
import { siteLogoContentRecipe } from "../../../example/recipes/site-logo-content.recipe";
import {
  type CompileContext,
  compileContentItemRecipe,
  compileRecipe,
} from "../../../src/recipe/compile";
import {
  contentItemId,
  fieldId,
  templateId,
  workflowId,
  workflowStateId,
} from "../../../src/recipe/items/guids";
import type { ContentFieldValue, ContentItemRecipe } from "../../../src/recipe/schema/recipe";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";
import { LAYOUT_FIELDS, SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  contentItemsRoot: "/sitecore/content/Demo/Data",
};

const SITE = "default";

const findCreate = (ops: Operation[]): CreateItemOp =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem")!;

// Field SetField labels carry a locator tag: `en` for the simple-mode
// primary language, `shared` for storage:shared fields, `<lang>.v<n>` for
// a story version. `tag` defaults to the simple-mode primary language.
const findSet = (
  ops: Operation[],
  fieldName: string,
  recipeHandle: string,
  tag = "en"
): SetFieldOp =>
  ops.find(
    (op): op is SetFieldOp =>
      op.op === "SetField" && op.label === `content-item-field:${recipeHandle}:${tag}:${fieldName}`
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
    expect(create.id).toBe(contentItemId(SITE, "test-content@1"));
    expect(create.templateOf).toBe(templateId(SITE, "test-template@1"));
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
    expect(setTitle.fieldId).toBe(fieldId(SITE, "test-template@1", "Title"));
    expect(setTitle.itemRefKey).toBe(contentItemId(SITE, "test-content@1"));
  });

  it("SetField carries fieldName so the mutation resolves by name on the tenant", () => {
    // Recipe-derived fieldId is just an IR refKey — Sitecore assigns its
    // own GUID to the Template Field item, so the mutation can't resolve
    // by GUID. fieldName ('Body') is the recipe-stable name on the
    // template; Sitecore resolves it directly against the item's template.
    const ir = compileContentItemRecipe(
      buildRecipe({ Body: { shape: "text", value: "Hi" } }),
      CONTEXT
    );
    const setBody = findSet(ir.operations, "Body", "test-content@1");
    expect(setBody.fieldName).toBe("Body");
  });

  it("throws when contentItemsRoot is missing", () => {
    expect(() =>
      compileContentItemRecipe(buildRecipe({}), {
        templatesRoot: CONTEXT.templatesRoot,
        renderingsRoot: CONTEXT.renderingsRoot,
      })
    ).toThrow(/contentItemsRoot/);
  });

  it("emits a SetField on __Workflow when workflow is set", () => {
    const ir = compileContentItemRecipe(buildRecipe({}, { workflow: "blog-approval@1" }), CONTEXT);
    const wf = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "content-item-workflow:test-content@1"
    )!;
    expect(wf).toBeDefined();
    expect(wf.itemRefKey).toBe(contentItemId(SITE, "test-content@1"));
    expect(wf.fieldName).toBe("__Workflow");
    expect(wf.value).toEqual({
      kind: "ref-recipe",
      refKey: workflowId("blog-approval@1"),
    });
  });

  it("omits the __Workflow SetField when workflow is unset", () => {
    const ir = compileContentItemRecipe(buildRecipe({}), CONTEXT);
    const wf = ir.operations.find(
      (op) => op.op === "SetField" && op.label.startsWith("content-item-workflow:")
    );
    expect(wf).toBeUndefined();
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
      refKeys: [contentItemId(SITE, "a@1"), contentItemId(SITE, "b@1"), contentItemId(SITE, "c@1")],
    });
  });
});

describe("compileContentItemRecipe — fixture round-trip", () => {
  it("compiles primary-nav-content@1 cleanly (text + reference shapes)", () => {
    const ir = compileContentItemRecipe(primaryNavContentRecipe, CONTEXT);
    expect(ir.recipeHandle).toBe("primary-nav-content@1");
    const create = findCreate(ir.operations);
    expect(create.templateOf).toBe(templateId(SITE, "primary-nav-template@1"));

    const links = findSet(ir.operations, "Links", "primary-nav-content@1");
    expect(links.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [
        contentItemId(SITE, "nav-link-products@1"),
        contentItemId(SITE, "nav-link-pricing@1"),
        contentItemId(SITE, "nav-link-docs@1"),
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

describe("compileContentItemRecipe — translations (simple mode)", () => {
  it("emits AddItemVersion + SetFields per translation language", () => {
    const ir = compileContentItemRecipe(
      buildRecipe(
        { Title: { shape: "text", value: "Welcome" } },
        {
          translations: {
            fr: { fields: { Title: { shape: "text", value: "Bienvenue" } } },
          },
        }
      ),
      CONTEXT
    );

    // The primary language stays at en v1; fr needs its language version made.
    const addFr = ir.operations.find((op) => op.op === "AddItemVersion" && op.language === "fr");
    expect(addFr).toMatchObject({ op: "AddItemVersion", language: "fr", version: 1 });

    const frTitle = findSet(ir.operations, "Title", "test-content@1", "fr");
    expect(frTitle.language).toBe("fr");
    expect(frTitle.version).toBe(1);
    expect(frTitle.value).toEqual({ kind: "string", value: "Bienvenue" });

    // Op order — every AddItemVersion precedes every SetField.
    const lastAdd = ir.operations.map((o) => o.op).lastIndexOf("AddItemVersion");
    const firstSet = ir.operations.map((o) => o.op).indexOf("SetField");
    expect(lastAdd).toBeLessThan(firstSet);
  });
});

describe("compileContentItemRecipe — story mode (versions)", () => {
  const story = () =>
    compileContentItemRecipe(
      buildRecipe(
        {},
        {
          versions: {
            en: [
              { version: 1, fields: { Headline: { shape: "text", value: "Coming soon" } } },
              { version: 2, fields: { Headline: { shape: "text", value: "We launched" } } },
            ],
          },
        }
      ),
      CONTEXT
    );

  it("adds an AddItemVersion for every version except the default-language v1", () => {
    const adds = story().operations.filter((op) => op.op === "AddItemVersion");
    // en v1 is made by CreateItem; only v2 needs an explicit AddItemVersion.
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ op: "AddItemVersion", language: "en", version: 2 });
  });

  it("emits per-version SetFields targeting the right numbered version", () => {
    const ops = story().operations;
    expect(findSet(ops, "Headline", "test-content@1", "en.v1").version).toBe(1);
    expect(findSet(ops, "Headline", "test-content@1", "en.v2").version).toBe(2);
    expect(findSet(ops, "Headline", "test-content@1", "en.v2").value).toEqual({
      kind: "string",
      value: "We launched",
    });
  });

  it("rejects a recipe that mixes story `versions` with simple `fields`", () => {
    expect(() =>
      compileContentItemRecipe(
        buildRecipe(
          { Title: { shape: "text", value: "x" } },
          { versions: { en: [{ version: 1, fields: {} }] } }
        ),
        CONTEXT
      )
    ).toThrow(/either simple .* or a story/);
  });

  it("rejects per-version personalization variants (not yet compiled)", () => {
    expect(() =>
      compileContentItemRecipe(
        buildRecipe(
          {},
          {
            versions: {
              en: [{ version: 1, fields: {}, variants: [{ audience: "returning-visitor" }] }],
            },
          }
        ),
        CONTEXT
      )
    ).toThrow(/not yet compiled/);
  });

  it("compiles a per-version layout into a __Final Renderings SetField", () => {
    const ir = compileContentItemRecipe(
      buildRecipe(
        {},
        {
          versions: {
            en: [
              {
                version: 1,
                fields: {},
                layout: { placeholders: { "headless-main": [{ componentHandle: "hero@1" }] } },
              },
            ],
          },
        }
      ),
      CONTEXT
    );
    const layoutSet = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.fieldId === LAYOUT_FIELDS.FINAL_RENDERINGS
    );
    expect(layoutSet).toBeDefined();
    expect(layoutSet?.language).toBe("en");
    expect(layoutSet?.version).toBe(1);
    expect(layoutSet?.value).toMatchObject({ kind: "string" });
  });

  it("compiles per-version workflowState into a __Workflow state SetField", () => {
    const ir = compileContentItemRecipe(
      buildRecipe(
        {},
        {
          workflow: "editorial@1",
          versions: {
            en: [
              { version: 1, fields: {}, workflowState: "draft" },
              { version: 2, fields: {}, workflowState: "approved" },
            ],
          },
        }
      ),
      CONTEXT
    );
    const stateSets = ir.operations.filter(
      (op): op is SetFieldOp => op.op === "SetField" && op.fieldName === "__Workflow state"
    );
    expect(stateSets).toHaveLength(2);
    const v2 = stateSets.find((op) => op.version === 2);
    expect(v2?.value).toEqual({
      kind: "ref-recipe",
      refKey: workflowStateId("editorial@1", "approved"),
    });
  });

  it("rejects a per-version workflowState when the recipe has no workflow", () => {
    expect(() =>
      compileContentItemRecipe(
        buildRecipe({}, { versions: { en: [{ version: 1, fields: {}, workflowState: "draft" }] } }),
        CONTEXT
      )
    ).toThrow(/no `workflow`/);
  });

  it("compiles a per-version date into a __Created SetField", () => {
    const ir = compileContentItemRecipe(
      buildRecipe(
        {},
        { versions: { en: [{ version: 1, fields: {}, date: "2026-01-10T00:00:00Z" }] } }
      ),
      CONTEXT
    );
    const created = ir.operations.find(
      (op): op is SetFieldOp => op.op === "SetField" && op.fieldName === "__Created"
    );
    expect(created?.version).toBe(1);
    expect(created?.value).toEqual({ kind: "string", value: "20260110T000000Z" });
  });
});

describe("compileContentItemRecipe — shared fields", () => {
  it("emits storage:shared fields as SetFields with no language/version", () => {
    const ir = compileContentItemRecipe(
      buildRecipe(
        { Title: { shape: "text", value: "Hello" } },
        { shared: { CampaignCode: { shape: "text", value: "LAUNCH26" } } }
      ),
      CONTEXT
    );
    const sharedSet = findSet(ir.operations, "CampaignCode", "test-content@1", "shared");
    expect(sharedSet.language).toBeUndefined();
    expect(sharedSet.version).toBeUndefined();
    expect(sharedSet.value).toEqual({ kind: "string", value: "LAUNCH26" });
  });
});
