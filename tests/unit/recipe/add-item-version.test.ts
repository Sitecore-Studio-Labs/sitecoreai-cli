/**
 * Unit tests for the `AddItemVersion` op's planner wiring (`buildAction` →
 * `planAddItemVersion`). The op materialises numbered/language versions for
 * story-seed content recipes; the planner reads `getItemVersions` and emits
 * an `addItemVersion` mutation only when the declared version is missing —
 * idempotent by construction.
 */
import { describe, expect, it } from "vitest";
import type { AddItemVersionOp } from "../../../src/recipe/ir/operations";
import { buildAction } from "../../../src/recipe/runtime/plan";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const ITEM_REF_KEY = "22222222-2222-2222-2222-222222222222";

/** Preload the target item — a tenant item starts at en v1 (see `preload`). */
const preloadItem = (client: MockAuthoringClient): void => {
  client.preload({
    itemId: ITEM_ID,
    templateId: "33333333-3333-3333-3333-333333333333",
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "Hero",
    path: "/sitecore/content/Hero",
    fields: [],
  });
};

const addVersionOp = (language: string, version: number): AddItemVersionOp => ({
  op: "AddItemVersion",
  policy: "CreateAndUpdate",
  label: `add-version:${language}:${version}`,
  itemRefKey: ITEM_REF_KEY,
  language,
  version,
});

describe("AddItemVersion — planner", () => {
  it("plans a create when the target numbered version is missing", async () => {
    const client = new MockAuthoringClient();
    preloadItem(client); // item has en v1
    const captured = new Map([[ITEM_REF_KEY, ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: addVersionOp("en", 2),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
    expect(action.mutation).toEqual({
      kind: "addItemVersion",
      itemId: ITEM_ID,
      language: "en",
      addCount: 1,
    });
  });

  it("skips when the numbered version already exists — idempotent re-push", async () => {
    const client = new MockAuthoringClient();
    preloadItem(client); // en v1 already present
    const captured = new Map([[ITEM_REF_KEY, ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: addVersionOp("en", 1),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
    expect(action.mutation).toBeUndefined();
    expect(action.reason).toMatch(/already exists/);
  });

  it("plans the first version of a new language (addCount counts from zero)", async () => {
    const client = new MockAuthoringClient();
    preloadItem(client); // en v1, no fr versions
    const captured = new Map([[ITEM_REF_KEY, ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: addVersionOp("fr", 1),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
    expect(action.mutation).toMatchObject({
      kind: "addItemVersion",
      language: "fr",
      addCount: 1,
    });
  });

  it("skips when the target item is not yet captured/created", async () => {
    const client = new MockAuthoringClient();
    preloadItem(client);

    // Empty captured map — the item's CreateItem hasn't run.
    const action = await buildAction({
      index: 0,
      op: addVersionOp("en", 2),
      client,
      capturedItemIds: new Map(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/not yet captured/);
  });

  it("reconciles a multi-version gap into addCount", async () => {
    const client = new MockAuthoringClient();
    preloadItem(client); // en v1
    const captured = new Map([[ITEM_REF_KEY, ITEM_ID]]);

    // Target version 4 against a lone v1 → add 3.
    const action = await buildAction({
      index: 0,
      op: addVersionOp("en", 4),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
    expect(action.mutation).toMatchObject({ kind: "addItemVersion", addCount: 3 });
  });
});
