import { describe, expect, it } from "vitest";
import { compilePageTemplateRecipe, type CompileContext } from "../../../src/recipe/compile";
import { executeIr } from "../../../src/recipe/runtime/execute";
import { hashFieldValue, indexBaseline } from "../../../src/recipe/runtime/baseline";
import {
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type { PageTemplateRecipe } from "../../../src/recipe/schema/recipe";
import type { CreateItemOp, OperationIr, SetFieldOp } from "../../../src/recipe/ir/operations";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Duke/Duke Energy/Components",
  pageTemplatesRoot: "/sitecore/templates/Project/Duke/Duke Energy/Pages",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Duke/Duke Energy/Components",
  sitePathSegment: "Duke/Duke Energy",
};

const COLLECTION_PAGE_PATH = "/sitecore/templates/Project/Duke/Page";
const COLLECTION_PAGE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const pageTemplate = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "page@1",
  name: "Page",
  displayName: "Page",
  fields: [{ name: "Title", shape: "text" }],
} satisfies PageTemplateRecipe;

const seedCollectionPage = (client: MockAuthoringClient): void => {
  client.preload({
    itemId: COLLECTION_PAGE_ID,
    templateId: SITECORE_TEMPLATES.TEMPLATE,
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "Page",
    path: COLLECTION_PAGE_PATH,
    fields: [],
  });
};

const appliedBaseTemplates = async (client: MockAuthoringClient): Promise<string> => {
  const created = await client.getItem({
    path: "/sitecore/templates/Project/Duke/Duke Energy/Pages/Page",
  });
  expect(created).not.toBeNull();
  const base = created!.fields.find(
    (f) => f.fieldId.toLowerCase() === SYSTEM_FIELDS.BASE_TEMPLATE.toLowerCase()
  );
  expect(base).toBeDefined();
  return (base!.value ?? "").toLowerCase();
};

describe("page template inheritance — end-to-end through executeIr (apply)", () => {
  it("chains the SXA page facet set directly — a PEER of the collection Page, not a subtype", async () => {
    // The collection's scaffolded Page exists on the tenant; the recipe
    // template must NOT inherit it. It mirrors the same facet chain the
    // scaffold itself carries (operator verdict on live tenants — an
    // earlier iteration subtyped the scaffold via path-resolved bases).
    const client = new MockAuthoringClient();
    seedCollectionPage(client);

    const ir = compilePageTemplateRecipe(pageTemplate, CONTEXT);
    const result = await executeIr(ir, client, { mode: "apply" });
    expect(result.aborted).toBe(false);
    expect(result.summary.error).toBe(0);
    expect(result.summary.conflict).toBe(0);

    const value = await appliedBaseTemplates(client);
    for (const facet of SXA_HEADLESS_PAGE_BASE_TEMPLATES) {
      expect(value).toContain(facet.toLowerCase());
    }
    // No explicit Standard template (Base Page chains it) and no
    // reference to the collection scaffold.
    expect(value).not.toContain(STANDARD_TEMPLATE_ID.toLowerCase());
    expect(value).not.toContain(COLLECTION_PAGE_ID.toLowerCase());
  });

  it("emits no pathBases — the facet chain is fully compile-time", () => {
    const ir = compilePageTemplateRecipe(pageTemplate, CONTEXT);
    const base = ir.operations.find((op) => op.op === "SetBaseTemplates");
    expect(base).toBeDefined();
    if (base?.op !== "SetBaseTemplates") throw new Error("expected SetBaseTemplates");
    expect(base.pathBases).toBeUndefined();
    expect(base.baseTemplates).toEqual([...SXA_HEADLESS_PAGE_BASE_TEMPLATES]);
  });

  it("a stale baseline never blocks writes to items created in the same run", async () => {
    // Regression: relocating an item (Components → Pages bucket) reuses
    // its deterministic refKey. A baseline captured against the OLD item
    // then classifies the fresh item's server-default field values as a
    // cms-edit/conflict and (under the default policy) blocks the write —
    // shipping items with default values. Items created this run must
    // bypass baseline classification: they cannot carry author edits.
    const ITEM_REF = "12345678-1234-5123-8123-123456789012";
    const FIELD_ID = "abcdef01-2345-4678-89ab-cdef01234567";
    const ir: OperationIr = {
      schemaVersion: "1",
      recipeHandle: "fresh@1",
      operations: [
        {
          op: "CreateItem",
          policy: "CreateAndUpdate",
          label: "template:fresh@1",
          id: ITEM_REF,
          path: "/sitecore/templates/Project/Duke/Duke Energy/Pages/Fresh",
          parent: {
            kind: "ref-path",
            value: "/sitecore/templates/Project/Duke/Duke Energy/Pages",
          },
          templateOf: SITECORE_TEMPLATES.TEMPLATE,
          name: "Fresh",
          fields: [],
        } satisfies CreateItemOp,
        {
          op: "SetField",
          policy: "CreateAndUpdate",
          label: "field:fresh@1:Body",
          itemRefKey: ITEM_REF,
          fieldId: FIELD_ID,
          fieldName: "Body",
          language: "en",
          version: 1,
          value: { kind: "string", value: "recipe value" },
        } satisfies SetFieldOp,
      ],
    };
    // Baseline from a previous push where the (now recreated) item held
    // a different value — desired ≠ baseline AND tenant(absent) ≠
    // baseline would classify as conflict for a pre-existing item.
    const baseline = {
      schemaVersion: "1" as const,
      recipeHandle: "fresh@1",
      envName: "test",
      capturedAt: "2026-07-01T00:00:00Z",
      fields: [
        {
          itemRefKey: ITEM_REF,
          fieldId: FIELD_ID,
          fieldName: "Body",
          language: "en" as const,
          version: 1,
          valueHash: hashFieldValue("old baseline value"),
        },
      ],
    };

    const client = new MockAuthoringClient();
    const result = await executeIr(ir, client, {
      mode: "apply",
      baselineIndex: indexBaseline(baseline),
      createdItemRefKeys: new Set<string>(),
      // Default conflictPolicy ("error") — without the created-this-run
      // bypass this surfaced as status=conflict and the field was never
      // written.
    });
    expect(result.aborted).toBe(false);
    expect(result.summary.conflict).toBe(0);
    expect(result.summary.update).toBe(1);

    const created = await client.getItem({
      path: "/sitecore/templates/Project/Duke/Duke Energy/Pages/Fresh",
    });
    const body = created!.fields.find((f) => f.name === "Body");
    expect(body?.value).toBe("recipe value");
  });
});
