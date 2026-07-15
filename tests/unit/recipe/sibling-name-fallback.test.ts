import { describe, expect, it, vi } from "vitest";
import type { ItemSelector, RemoteFieldValue, RemoteItem } from "../../../src/recipe/api/client";
import type { CreateItemOp } from "../../../src/recipe/ir/operations";
import { buildAction } from "../../../src/recipe/runtime/plan";
import { injectHandleMarker, SCAI_HANDLE_FIELD_NAME } from "../../../src/recipe/items/marker";
import { MockAuthoringClient } from "./_fixtures/mock-client";

/**
 * The plan-time sibling-name fallback exists to defend against
 * Sitecore's path-index lag, which can cause `getItem({path})` to
 * return null for a path the tenant actually has (seconds-to-minutes
 * after a recent write). Without this fallback, a repeat push within
 * that window plans a duplicate `createItem` against the already-
 * existing path; the trap in the authoring client catches some failure
 * modes but not all server phrasings of the conflict.
 */

const PARENT_PATH = "/sitecore/templates/Project/sandbox";
const PARENT_ITEM_ID = "11111111-1111-1111-1111-111111111111";
const CHILD_NAME = "CtaButton";
const CHILD_PATH = `${PARENT_PATH}/${CHILD_NAME}`;
const CHILD_ITEM_ID = "22222222-2222-2222-2222-222222222222";
const CHILD_REF_KEY = "33333333-3333-3333-3333-333333333333";

const newCreateOp = (): CreateItemOp => ({
  op: "CreateItem",
  policy: "CreateAndUpdate",
  label: "create:CtaButton",
  id: CHILD_REF_KEY,
  path: CHILD_PATH,
  parent: { kind: "ref-path", value: PARENT_PATH },
  templateOf: "44444444-4444-4444-4444-444444444444",
  name: CHILD_NAME,
  fields: [],
});

/** Mock that simulates path-index lag: `getItem({path})` lies about a single path. */
class LaggingMockClient extends MockAuthoringClient {
  private lagPaths = new Set<string>();
  hideFromPathIndex(path: string): void {
    this.lagPaths.add(path);
  }
  async getItem(selector: ItemSelector): Promise<RemoteItem | null> {
    if (selector.path && this.lagPaths.has(selector.path)) return null;
    return super.getItem(selector);
  }
  async getItemsByPaths(paths: readonly string[]): Promise<Map<string, RemoteItem | null>> {
    const result = await super.getItemsByPaths(paths);
    for (const p of this.lagPaths) {
      if (result.has(p)) result.set(p, null);
    }
    return result;
  }
}

const seedParentAndChild = (client: LaggingMockClient): void => {
  client.preload({
    itemId: PARENT_ITEM_ID,
    templateId: "55555555-5555-5555-5555-555555555555",
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "sandbox",
    path: PARENT_PATH,
    fields: [],
  });
  client.preload({
    itemId: CHILD_ITEM_ID,
    templateId: "44444444-4444-4444-4444-444444444444",
    parentId: PARENT_ITEM_ID,
    name: CHILD_NAME,
    path: CHILD_PATH,
    fields: [],
  });
};

describe("CreateItem — sibling-name fallback under path-index lag", () => {
  it("recovers an existing item via getChildren when path-index reports null", async () => {
    const client = new LaggingMockClient();
    seedParentAndChild(client);
    client.hideFromPathIndex(CHILD_PATH);
    // Captured map seeded with the parent's itemId — mirrors what the
    // workspace prefetch leaves behind after the parent's getItem
    // resolves (parent path lookups aren't lagged; only freshly-written
    // child paths are).
    const captured = new Map<string, string>([[PARENT_PATH, PARENT_ITEM_ID]]);
    const snapshotCache = new Map<string, RemoteItem | null>();

    const action = await buildAction({
      index: 0,
      op: newCreateOp(),
      client,
      capturedItemIds: captured,
      pathSnapshotCache: snapshotCache,
    });

    // CreateAndUpdate + zero drift → skip, not create.
    expect(action.status).toBe("skip");
    expect(client.creates).toHaveLength(0);
    // The fallback also seeds the captured map and the snapshot cache
    // so downstream ops see the existing item.
    expect(captured.get(CHILD_REF_KEY)).toBe(CHILD_ITEM_ID);
    expect(snapshotCache.get(CHILD_PATH)?.itemId).toBe(CHILD_ITEM_ID);
  });

  it("does not fire on a true first push (parent itself doesn't exist)", async () => {
    // Neither parent nor child preloaded — simulates a fresh subtree
    // being created for the first time. Parent path resolution returns
    // null too, so the fallback's gate (parent-itemId-known) keeps it
    // dormant and the planner correctly schedules a create.
    const client = new LaggingMockClient();
    const captured = new Map<string, string>();
    const getChildrenSpy = vi.fn(client.getChildren.bind(client));
    client.getChildren = getChildrenSpy as never;

    const action = await buildAction({
      index: 0,
      op: newCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
    expect(getChildrenSpy).not.toHaveBeenCalled();
  });

  it("does not over-trigger when path-index reports the item correctly", async () => {
    const client = new LaggingMockClient();
    seedParentAndChild(client);
    // No lag — getItem returns the item normally.
    const captured = new Map<string, string>([[PARENT_PATH, PARENT_ITEM_ID]]);
    const getChildrenSpy = vi.fn(client.getChildren.bind(client));
    client.getChildren = getChildrenSpy as never;

    const action = await buildAction({
      index: 0,
      op: newCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
    expect(getChildrenSpy).not.toHaveBeenCalled();
  });
});

/**
 * Marker-match fallback: a CMS user can rename a recipe-managed item, so
 * neither its path nor its sibling NAME matches the recipe any more. The
 * `Scai Handle` marker is rename-immune identity — a sibling still carrying
 * the recipe's handle IS the item. Because the marker carries the *recipe*
 * handle (shared by every item one recipe creates under a parent), the match
 * is trusted only when exactly one sibling carries it.
 */
const HANDLE = "cta-button@1";

/** A CreateItem op with the `Scai Handle` marker stamped on (as `push` does). */
const markedCreateOp = (handle = HANDLE): CreateItemOp => {
  const ir = injectHandleMarker({
    schemaVersion: "1",
    recipeHandle: handle,
    operations: [newCreateOp()],
  });
  return ir.operations[0] as CreateItemOp;
};

/** A live `Scai Handle` field value, as `getChildren` would return it. */
const remoteMarker = (handle: string): RemoteFieldValue => ({
  fieldId: "00000000-0000-0000-0000-5ca15ca15ca1",
  name: SCAI_HANDLE_FIELD_NAME,
  value: handle,
});

/** Preload the parent, then a marker-carrying child under a given name. */
const seedRenamedChild = (
  client: LaggingMockClient,
  childName: string,
  marker: string,
  itemId = CHILD_ITEM_ID
): void => {
  client.preload({
    itemId: PARENT_ITEM_ID,
    templateId: "55555555-5555-5555-5555-555555555555",
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "sandbox",
    path: PARENT_PATH,
    fields: [],
  });
  client.preload({
    itemId,
    templateId: "44444444-4444-4444-4444-444444444444",
    parentId: PARENT_ITEM_ID,
    name: childName,
    path: `${PARENT_PATH}/${childName}`,
    fields: [remoteMarker(marker)],
  });
};

describe("CreateItem — marker-match fallback for renamed items", () => {
  it("recovers a renamed item via its Scai Handle marker", async () => {
    const client = new LaggingMockClient();
    // The item was renamed in the CMS: it lives at `.../OldCtaButton`, not
    // the `.../CtaButton` path the recipe expects — but still carries the
    // recipe's handle.
    seedRenamedChild(client, "OldCtaButton", HANDLE);
    const captured = new Map<string, string>([[PARENT_PATH, PARENT_ITEM_ID]]);
    const snapshotCache = new Map<string, RemoteItem | null>();

    const action = await buildAction({
      index: 0,
      op: markedCreateOp(),
      client,
      capturedItemIds: captured,
      pathSnapshotCache: snapshotCache,
    });

    // Marker-matched → the existing item is reused, not duplicated.
    expect(action.status).toBe("skip");
    expect(client.creates).toHaveLength(0);
    expect(captured.get(CHILD_REF_KEY)).toBe(CHILD_ITEM_ID);
  });

  it("does not marker-match when two siblings carry the same recipe handle", async () => {
    // A recipe stamps every item it creates under one parent with the same
    // handle — two marked siblings can't be disambiguated, so the planner
    // declines the rebind and schedules a create rather than risk the wrong
    // item.
    const client = new LaggingMockClient();
    seedRenamedChild(client, "OldA", HANDLE, CHILD_ITEM_ID);
    seedRenamedChild(client, "OldB", HANDLE, "66666666-6666-6666-6666-666666666666");
    const captured = new Map<string, string>([[PARENT_PATH, PARENT_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: markedCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
  });

  it("does not marker-match a sibling carrying a different recipe's handle", async () => {
    const client = new LaggingMockClient();
    seedRenamedChild(client, "OldCtaButton", "hero@1");
    const captured = new Map<string, string>([[PARENT_PATH, PARENT_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: markedCreateOp(),
      client,
      capturedItemIds: captured,
    });

    // The only marked sibling belongs to `hero@1`, not `cta-button@1`.
    expect(action.status).toBe("create");
  });
});

/**
 * Template guard on the marker fallback: a recipe that swaps the component
 * behind a slot (e.g. a partial design's header moving from `main-nav@1` to
 * `header@1`) renames its scoped datasource AND changes its template. The
 * stale item still carries the recipe's marker, but it is NOT a rename —
 * rebinding onto it leaves the old template in place and every SetField for
 * a new-template-only field aborts with "Cannot find a field with the name
 * <X>". A marked sibling only counts as a rename when its live templateId
 * matches the op's expected template (when that is knowable).
 */
describe("CreateItem — marker-match template guard (component swap)", () => {
  // The op's templateOf refKey, resolved to a live template itemId the way
  // `seedCrossRecipeRefs` does before planning starts.
  const TEMPLATE_REF_KEY = "44444444-4444-4444-4444-444444444444";
  const LIVE_NEW_TEMPLATE_ID = "77777777-7777-4777-8777-777777777777";
  const LIVE_OLD_TEMPLATE_ID = "88888888-8888-4888-8888-888888888888";

  const capturedWithTemplate = (): Map<string, string> =>
    new Map<string, string>([
      [PARENT_PATH, PARENT_ITEM_ID],
      [TEMPLATE_REF_KEY, LIVE_NEW_TEMPLATE_ID],
    ]);

  /** Preload the parent + a marked child under `oldName` with a given live template. */
  const seedSwappedChild = (client: LaggingMockClient, liveTemplateId: string): void => {
    client.preload({
      itemId: PARENT_ITEM_ID,
      templateId: "55555555-5555-5555-5555-555555555555",
      parentId: "00000000-0000-0000-0000-000000000000",
      name: "sandbox",
      path: PARENT_PATH,
      fields: [],
    });
    client.preload({
      itemId: CHILD_ITEM_ID,
      templateId: liveTemplateId,
      parentId: PARENT_ITEM_ID,
      name: "OldSlotName",
      path: `${PARENT_PATH}/OldSlotName`,
      fields: [remoteMarker(HANDLE)],
    });
  };

  it("declines the rebind when the marked sibling's template differs (plans a create)", async () => {
    const client = new LaggingMockClient();
    seedSwappedChild(client, LIVE_OLD_TEMPLATE_ID);

    const action = await buildAction({
      index: 0,
      op: markedCreateOp(),
      client,
      capturedItemIds: capturedWithTemplate(),
    });

    // Different template = component swap, not a CMS rename — create fresh.
    expect(action.status).toBe("create");
  });

  it("still rebinds when the marked sibling's template matches the resolved template", async () => {
    const client = new LaggingMockClient();
    seedSwappedChild(client, LIVE_NEW_TEMPLATE_ID);
    const captured = capturedWithTemplate();

    const action = await buildAction({
      index: 0,
      op: markedCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
    expect(captured.get(CHILD_REF_KEY)).toBe(CHILD_ITEM_ID);
  });

  it("normalizes GUID shape before comparing (undashed uppercase still matches)", async () => {
    const client = new LaggingMockClient();
    seedSwappedChild(client, LIVE_NEW_TEMPLATE_ID.replace(/-/g, "").toUpperCase());

    const action = await buildAction({
      index: 0,
      op: markedCreateOp(),
      client,
      capturedItemIds: capturedWithTemplate(),
    });

    expect(action.status).toBe("skip");
  });

  it("skips the guard when the expected template can't be resolved to a live id", async () => {
    const client = new LaggingMockClient();
    // Old-template child, but the captured map has NO entry for the op's
    // templateOf refKey — ambiguous (built-in constant vs unseeded
    // deterministic refKey), so the guard must stay inactive and the
    // rename fallback keep its pre-guard behavior.
    seedSwappedChild(client, LIVE_OLD_TEMPLATE_ID);
    const captured = new Map<string, string>([[PARENT_PATH, PARENT_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: markedCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
  });
});
