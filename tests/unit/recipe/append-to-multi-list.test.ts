import { describe, expect, it } from "vitest";
import { buildAction } from "../../../src/recipe/runtime/plan";
import type { AppendToMultiListOp } from "../../../src/recipe/ir/operations";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const SECTION_ITEM_ID = "11111111-1111-1111-1111-111111111111";
const SECTION_REF_KEY = "22222222-2222-2222-2222-222222222222";
const RENDERING_REF_KEY = "33333333-3333-3333-3333-333333333333";
const RENDERING_ITEM_ID = "44444444-4444-4444-4444-444444444444";

const FIELD_ID = "55555555-5555-5555-5555-555555555555";
const SECTION_PATH =
  "/sitecore/content/test-tenant/test-site/Presentation/Available Renderings/Showcase";

const newOp = (
  values: AppendToMultiListOp["values"] = [{ kind: "ref-recipe", refKey: RENDERING_REF_KEY }]
): AppendToMultiListOp => ({
  op: "AppendToMultiList",
  policy: "CreateAndUpdate",
  label: "available-in:test",
  itemRefKey: SECTION_REF_KEY,
  latePath: SECTION_PATH,
  fieldId: FIELD_ID,
  fieldName: "Available Renderings",
  values,
  appendPolicy: "merge-unique",
});

const seedSectionItem = (
  client: MockAuthoringClient,
  fieldValue: string | undefined = undefined
): void => {
  client.preload({
    itemId: SECTION_ITEM_ID,
    templateId: "abcdef01-2345-6789-abcd-ef0123456789",
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "Showcase",
    path: SECTION_PATH,
    fields:
      fieldValue !== undefined
        ? [{ fieldId: FIELD_ID, name: "Available Renderings", value: fieldValue }]
        : [],
  });
};

describe("AppendToMultiList — late-path seeding", () => {
  it("seeds the captured map from latePath when itemRefKey is missing", async () => {
    const client = new MockAuthoringClient();
    seedSectionItem(client);
    const captured = new Map<string, string>([[RENDERING_REF_KEY, RENDERING_ITEM_ID]]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });

    expect(captured.get(SECTION_REF_KEY)).toBe(SECTION_ITEM_ID);
    expect(action.status).toBe("update");
  });
});

describe("AppendToMultiList — merge-unique policy", () => {
  it("status update + appends when the value isn't already present", async () => {
    const client = new MockAuthoringClient();
    seedSectionItem(client, "{99999999-9999-9999-9999-999999999999}");
    const captured = new Map<string, string>([
      [SECTION_REF_KEY, SECTION_ITEM_ID],
      [RENDERING_REF_KEY, RENDERING_ITEM_ID],
    ]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });

    expect(action.status).toBe("update");
    if (action.mutation?.kind !== "updateItem") throw new Error("expected updateItem");
    const incoming = action.mutation.input.fields[0];
    if (incoming.value.kind !== "string") throw new Error("expected string value");
    // Existing value preserved, new value appended.
    expect(incoming.value.value).toContain("{99999999-9999-9999-9999-999999999999}");
    expect(incoming.value.value.toLowerCase()).toContain(RENDERING_ITEM_ID.toLowerCase());
  });

  it("status skip when the value is already present (idempotent)", async () => {
    const client = new MockAuthoringClient();
    seedSectionItem(client, `{${RENDERING_ITEM_ID.toUpperCase()}}`);
    const captured = new Map<string, string>([
      [SECTION_REF_KEY, SECTION_ITEM_ID],
      [RENDERING_REF_KEY, RENDERING_ITEM_ID],
    ]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/already present/);
  });

  it("status skip when refKey isn't yet captured (producer hasn't landed)", async () => {
    const client = new MockAuthoringClient();
    seedSectionItem(client);
    // Section captured, but rendering's refKey is not — simulating
    // cross-recipe ordering where the producer hasn't run.
    const captured = new Map<string, string>([[SECTION_REF_KEY, SECTION_ITEM_ID]]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });
    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/refKey .* not yet captured/);
  });

  it("status skip when the section item itself doesn't exist yet", async () => {
    const client = new MockAuthoringClient();
    // Section NOT preloaded; latePath lookup returns null.
    const captured = new Map<string, string>([[RENDERING_REF_KEY, RENDERING_ITEM_ID]]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });
    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/not yet captured/);
  });

  it("preserves existing values in their original order when appending", async () => {
    const client = new MockAuthoringClient();
    const existing =
      "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}|{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}";
    seedSectionItem(client, existing);
    const captured = new Map<string, string>([
      [SECTION_REF_KEY, SECTION_ITEM_ID],
      [RENDERING_REF_KEY, RENDERING_ITEM_ID],
    ]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });
    if (action.mutation?.kind !== "updateItem") throw new Error("expected updateItem");
    const incoming = action.mutation.input.fields[0];
    if (incoming.value.kind !== "string") throw new Error("expected string value");
    const merged = incoming.value.value.toLowerCase();
    expect(merged.indexOf("aaaaaaaa")).toBeLessThan(merged.indexOf("bbbbbbbb"));
    expect(merged.indexOf("bbbbbbbb")).toBeLessThan(
      merged.indexOf(RENDERING_ITEM_ID.toLowerCase())
    );
  });

  it("accepts ref-guid values directly without consulting captured map", async () => {
    const client = new MockAuthoringClient();
    seedSectionItem(client);
    const captured = new Map<string, string>([[SECTION_REF_KEY, SECTION_ITEM_ID]]);
    const directGuid = "12345678-1234-1234-1234-123456789012";

    const action = await buildAction({
      index: 0,
      op: newOp([{ kind: "ref-guid", value: directGuid }]),
      client,
      capturedItemIds: captured,
    });
    expect(action.status).toBe("update");
    if (action.mutation?.kind !== "updateItem") throw new Error("expected updateItem");
    const incoming = action.mutation.input.fields[0];
    if (incoming.value.kind !== "string") throw new Error("expected string");
    expect(incoming.value.value.toLowerCase()).toContain(directGuid);
  });
});

const replaceOp = (
  values: AppendToMultiListOp["values"] = [{ kind: "ref-recipe", refKey: RENDERING_REF_KEY }]
): AppendToMultiListOp => ({
  ...newOp(values),
  appendPolicy: "replace",
});

describe("AppendToMultiList — replace policy", () => {
  it("writes exactly the desired set, removing pre-existing entries the recipe didn't list", async () => {
    const client = new MockAuthoringClient();
    // Live list has TWO entries; the replace op specifies only ONE.
    // After apply, the live list should be exactly that one.
    const existing =
      "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}|{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}";
    seedSectionItem(client, existing);
    const captured = new Map<string, string>([
      [SECTION_REF_KEY, SECTION_ITEM_ID],
      [RENDERING_REF_KEY, RENDERING_ITEM_ID],
    ]);

    const action = await buildAction({
      index: 0,
      op: replaceOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("update");
    if (action.mutation?.kind !== "updateItem") throw new Error("expected updateItem");
    const incoming = action.mutation.input.fields[0];
    if (incoming.value.kind !== "string") throw new Error("expected string");
    const written = incoming.value.value.toLowerCase();
    expect(written).toContain(RENDERING_ITEM_ID.toLowerCase());
    expect(written).not.toContain("aaaaaaaa");
    expect(written).not.toContain("bbbbbbbb");

    // replacedListValues should reflect the diff.
    expect(action.replacedListValues).toBeDefined();
    expect(action.replacedListValues?.added.map((s) => s.toLowerCase())).toEqual([
      RENDERING_ITEM_ID.toLowerCase(),
    ]);
    expect(action.replacedListValues?.removed.sort()).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]);
  });

  it("status skip when the live set already matches the desired set (idempotent)", async () => {
    const client = new MockAuthoringClient();
    seedSectionItem(client, `{${RENDERING_ITEM_ID.toUpperCase()}}`);
    const captured = new Map<string, string>([
      [SECTION_REF_KEY, SECTION_ITEM_ID],
      [RENDERING_REF_KEY, RENDERING_ITEM_ID],
    ]);

    const action = await buildAction({
      index: 0,
      op: replaceOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/already matches/);
    expect(action.replacedListValues).toEqual({ added: [], removed: [] });
  });

  it("status update when the desired set is empty but the live list isn't (clears the field)", async () => {
    const client = new MockAuthoringClient();
    seedSectionItem(
      client,
      "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}|{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}"
    );
    const captured = new Map<string, string>([[SECTION_REF_KEY, SECTION_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: replaceOp([]),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("update");
    if (action.mutation?.kind !== "updateItem") throw new Error("expected updateItem");
    const incoming = action.mutation.input.fields[0];
    if (incoming.value.kind !== "string") throw new Error("expected string");
    expect(incoming.value.value).toBe("");
    expect(action.replacedListValues?.removed.length).toBe(2);
    expect(action.replacedListValues?.added).toEqual([]);
  });
});
