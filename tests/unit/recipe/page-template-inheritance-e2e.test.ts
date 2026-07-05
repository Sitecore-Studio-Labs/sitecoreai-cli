import { describe, expect, it } from "vitest";
import {
  compilePageTemplateRecipe,
  compileRecipeSet,
  type CompileContext,
} from "../../../src/recipe/compile";
import { PAGE_TEMPLATE_BASE_TEMPLATES_AGGREGATE_HANDLE } from "../../../src/recipe/compile/aggregates";
import type { RemoteItem } from "../../../src/recipe/api/client";
import { executeIr } from "../../../src/recipe/runtime/execute";
import { indexBaseline } from "../../../src/recipe/runtime/baseline";
import { hashFieldValue } from "../../../src/recipe/runtime/baseline";
import {
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type { PageTemplateRecipe } from "../../../src/recipe/schema/recipe";
import type { OperationIr, SetFieldOp, CreateItemOp } from "../../../src/recipe/ir/operations";
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
  it("the applied template inherits the tenant's collection Page item", async () => {
    const client = new MockAuthoringClient();
    seedCollectionPage(client);

    const ir = compilePageTemplateRecipe(pageTemplate, CONTEXT);
    const result = await executeIr(ir, client, { mode: "apply" });
    expect(result.aborted).toBe(false);
    expect(result.summary.error).toBe(0);
    expect(result.summary.conflict).toBe(0);

    const value = await appliedBaseTemplates(client);
    expect(value).toContain(STANDARD_TEMPLATE_ID.toLowerCase());
    expect(value).toContain(COLLECTION_PAGE_ID.toLowerCase());
    for (const facet of SXA_HEADLESS_PAGE_BASE_TEMPLATES) {
      expect(value).not.toContain(facet.toLowerCase());
    }
  });

  it("falls back to the SXA facet chain when the collection Page is absent", async () => {
    const client = new MockAuthoringClient();

    const ir = compilePageTemplateRecipe(pageTemplate, CONTEXT);
    const result = await executeIr(ir, client, { mode: "apply" });
    expect(result.aborted).toBe(false);

    const value = await appliedBaseTemplates(client);
    expect(value).toContain(STANDARD_TEMPLATE_ID.toLowerCase());
    for (const facet of SXA_HEADLESS_PAGE_BASE_TEMPLATES) {
      expect(value).toContain(facet.toLowerCase());
    }
  });

  it("fresh-collection install: the trailing aggregate corrects the chain after the site scaffolds Project/<collection>/Page", async () => {
    // Simulates the first install into a NEW site collection: at
    // page-template apply time (rank 0) the SXA scaffold doesn't exist
    // yet — the early base-templates op falls back to the facets, and
    // the workspace prefetch has cached the scaffold path as MISSING.
    // The site recipe (rank 5) then materialises the scaffold; the
    // trailing `__page-template-base-templates__` aggregate must
    // re-resolve (distrusting the cached null) and correct the chain.
    const client = new MockAuthoringClient();
    const pathSnapshotCache = new Map<string, RemoteItem | null>();
    // Workspace prefetch recorded the scaffold as missing.
    pathSnapshotCache.set(COLLECTION_PAGE_PATH, null);

    const irs = compileRecipeSet([pageTemplate], CONTEXT);
    const templateIr = irs.find((ir) => ir.recipeHandle === "page@1");
    const aggregateIr = irs.find(
      (ir) => ir.recipeHandle === PAGE_TEMPLATE_BASE_TEMPLATES_AGGREGATE_HANDLE
    );
    expect(templateIr).toBeDefined();
    expect(aggregateIr).toBeDefined();
    // Aggregate trails the ranked recipe IRs (it runs after `site`).
    expect(irs.indexOf(aggregateIr!)).toBeGreaterThan(irs.indexOf(templateIr!));

    // Cross-IR ref seeding, as the real push wires it: every CreateItem's
    // id → path across the set, so the aggregate IR (which creates
    // nothing itself) can resolve its target template.
    const crossRecipeRefs = new Map<string, string>(
      irs
        .flatMap((ir) => ir.operations)
        .filter((op): op is CreateItemOp => op.op === "CreateItem")
        .map((op) => [op.id, op.path])
    );

    // 1. Early IR applies with the scaffold absent → facet fallback.
    const createdItemRefKeys = new Set<string>();
    const first = await executeIr(templateIr!, client, {
      mode: "apply",
      pathSnapshotCache,
      createdItemRefKeys,
    });
    expect(first.aborted).toBe(false);
    let value = await appliedBaseTemplates(client);
    expect(value).not.toContain(COLLECTION_PAGE_ID.toLowerCase());

    // 2. "Site creation" scaffolds the collection Page mid-push.
    seedCollectionPage(client);

    // 3. The trailing aggregate re-resolves past the stale cached null
    //    and rewrites the chain.
    const second = await executeIr(aggregateIr!, client, {
      mode: "apply",
      pathSnapshotCache,
      createdItemRefKeys,
      crossRecipeRefs,
    });
    expect(second.aborted).toBe(false);
    value = await appliedBaseTemplates(client);
    expect(value).toContain(STANDARD_TEMPLATE_ID.toLowerCase());
    expect(value).toContain(COLLECTION_PAGE_ID.toLowerCase());
    for (const facet of SXA_HEADLESS_PAGE_BASE_TEMPLATES) {
      expect(value).not.toContain(facet.toLowerCase());
    }
  });

  it("the aggregate is not emitted when the collection is unknown", () => {
    const { sitePathSegment: _omit, ...noSegment } = CONTEXT;
    void _omit;
    const irs = compileRecipeSet([pageTemplate], noSegment);
    expect(
      irs.find((ir) => ir.recipeHandle === PAGE_TEMPLATE_BASE_TEMPLATES_AGGREGATE_HANDLE)
    ).toBeUndefined();
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
