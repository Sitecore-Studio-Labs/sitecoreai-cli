import { describe, expect, it, vi } from "vitest";
import type { SetFieldOp } from "../../../src/recipe/ir/operations";
import { LAYOUT_FIELDS } from "../../../src/recipe/ir/sitecore-templates";
import { inverseOf } from "../../../src/recipe/rollback/rollback";
import { buildAction } from "../../../src/recipe/runtime/plan";
import { MockAuthoringClient } from "./_fixtures/mock-client";

/**
 * Versioned → shared layout transition (`layoutScope: "shared"` on a
 * page whose earlier pushes wrote per-language `__Final Renderings`).
 * The compiler emits one guarded clearing SetField per declared
 * language (`clearWhenEquivalentTo`); `planGuardedLayoutClear` clears a
 * language's final only while it is still layout-equivalent to the
 * recipe's own versioned emission, and preserves author-edited finals.
 */

const PAGE_REF_KEY = "12121212-3434-5656-7878-909090909090";
const PAGE_ITEM_ID = "abababab-cdcd-efef-0101-232323232323";
const PAGE_PATH = "/sitecore/content/Demo/Home/Home";

// The recipe's versioned emission — what an earlier versioned push wrote
// into each language's Final Layout (Pages-native anchored delta form).
const OWNED_XML =
  '<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">' +
  '<r uid="{11111111-2222-3333-4444-555555555555}" p:before="*" ' +
  's:id="{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" s:ph="headless-main" /></d></r>';

// Same placements, different attribute order — Sitecore's layout
// pipeline normalises attribute order on write, so equivalence must be
// structural, not string equality.
const REORDERED_XML =
  '<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">' +
  '<r s:ph="headless-main" s:id="{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" p:before="*" ' +
  'uid="{11111111-2222-3333-4444-555555555555}" /></d></r>';

// An author edit in Pages: different rendering instance + datasource.
const EDITED_XML =
  '<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">' +
  '<r uid="{99999999-2222-3333-4444-555555555555}" p:before="*" ' +
  's:ds="local:/Data/hero 9" s:id="{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" ' +
  's:ph="headless-main" /></d></r>';

const clearOp = (language = "da"): SetFieldOp => ({
  op: "SetField",
  policy: "CreateOnly",
  label: `page-layout-clear-final:home@1:${language}`,
  itemRefKey: PAGE_REF_KEY,
  fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
  language,
  version: 1,
  value: { kind: "string", value: "" },
  clearWhenEquivalentTo: OWNED_XML,
});

const seedPage = (
  client: MockAuthoringClient,
  finals: ReadonlyArray<{ language: string; value: string }>
): void => {
  client.preload({
    itemId: PAGE_ITEM_ID,
    templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
    parentId: "00000000-0000-0000-0000-000000000aaa",
    name: "Home",
    path: PAGE_PATH,
    fields: finals.map((f) => ({
      fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
      name: "__Final Renderings",
      value: f.value,
      language: f.language,
      version: 1,
    })),
  });
};

const captured = () => new Map<string, string>([[PAGE_REF_KEY, PAGE_ITEM_ID]]);

describe("planGuardedLayoutClear — versioned → shared transition", () => {
  it("clears a recipe-owned final: update with an empty write at the op's (language, version)", async () => {
    const client = new MockAuthoringClient();
    seedPage(client, [
      { language: "en", value: OWNED_XML },
      { language: "da", value: OWNED_XML },
    ]);

    const action = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: captured(),
    });

    expect(action.status).toBe("update");
    if (action.mutation?.kind !== "updateItem") throw new Error("expected updateItem");
    expect(action.mutation.input.itemId).toBe(PAGE_ITEM_ID);
    expect(action.mutation.input.language).toBe("da");
    expect(action.mutation.input.version).toBe(1);
    expect(action.mutation.input.fields).toEqual([
      {
        fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
        fieldName: undefined,
        language: "da",
        version: 1,
        value: { kind: "string", value: "" },
      },
    ]);
    expect(action.diff).toEqual([
      {
        fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
        before: OWNED_XML,
        after: "",
        language: "da",
        version: 1,
      },
    ]);
  });

  it("equivalence is structural — a tenant-normalised (attribute-reordered) final still clears", async () => {
    const client = new MockAuthoringClient();
    seedPage(client, [{ language: "da", value: REORDERED_XML }]);

    const action = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: captured(),
    });

    expect(action.status).toBe("update");
  });

  it("preserves an author-edited final: skip with an explicit reason", async () => {
    const client = new MockAuthoringClient();
    seedPage(client, [{ language: "da", value: EDITED_XML }]);

    const action = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: captured(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/author-edited Final Layout preserved/);
    expect(action.reason).toContain("'da'");
  });

  it("the guard reads the op's OWN language cell — an edit in 'da' skips even when 'en' is recipe-owned", async () => {
    const client = new MockAuthoringClient();
    seedPage(client, [
      { language: "en", value: OWNED_XML },
      { language: "da", value: EDITED_XML },
    ]);

    const daAction = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: captured(),
    });
    const enAction = await buildAction({
      index: 1,
      op: clearOp("en"),
      client,
      capturedItemIds: captured(),
    });

    expect(daAction.status).toBe("skip");
    expect(enAction.status).toBe("update");
  });

  it("skips when the language has no final to clear (idempotent second shared push)", async () => {
    const client = new MockAuthoringClient();
    seedPage(client, [{ language: "en", value: OWNED_XML }]);

    const action = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: captured(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/No __Final Renderings to clear in 'da'/);
  });

  it("skips without a language-scoped read when the item was created this push", async () => {
    const client = new MockAuthoringClient();
    seedPage(client, [{ language: "da", value: OWNED_XML }]);
    const getItem = vi.spyOn(client, "getItem");

    const action = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: captured(),
      createdThisRun: new Set([PAGE_REF_KEY]),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/created this push/);
    // The generic default-language read may run; the per-cell read must not.
    const languageScopedCalls = getItem.mock.calls.filter(
      ([, options]) => options?.language !== undefined
    );
    expect(languageScopedCalls).toEqual([]);
  });

  it("skips when the page item's refKey isn't captured yet", async () => {
    const client = new MockAuthoringClient();

    const action = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: new Map(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/not yet captured/);
  });
});

describe("inverseOf — guarded layout clear rolls back the exact language cell", () => {
  it("restores the cleared final at the forward input's language/version", async () => {
    const client = new MockAuthoringClient();
    seedPage(client, [
      { language: "en", value: EDITED_XML },
      { language: "da", value: OWNED_XML },
    ]);

    const action = await buildAction({
      index: 0,
      op: clearOp("da"),
      client,
      capturedItemIds: captured(),
    });
    expect(action.status).toBe("update");

    const inverse = inverseOf(action, new Map());
    if (inverse?.kind !== "updateItem") throw new Error("expected updateItem inverse");
    // Input-level language/version carried over — without them the
    // Authoring API would restore into the default language's latest
    // version, smearing da's prior value over en.
    expect(inverse.input.language).toBe("da");
    expect(inverse.input.version).toBe(1);
    // The prior value comes from the LANGUAGE-SCOPED snapshot: da's
    // final, not en's (which this test intentionally made different).
    expect(inverse.input.fields).toEqual([
      {
        fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
        fieldName: undefined,
        language: "da",
        version: 1,
        value: { kind: "string", value: OWNED_XML },
      },
    ]);
  });
});
