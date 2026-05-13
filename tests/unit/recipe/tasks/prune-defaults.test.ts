import { describe, expect, it, vi } from "vitest";
import {
  pruneDefaultsAgainstClient,
  type PruneAction,
} from "../../../../src/recipe/tasks/prune-defaults";
import type {
  AuthoringApiClient,
  ItemSelector,
  RemoteItem,
} from "../../../../src/recipe/api/client";

const ROOTS = {
  availableRenderingsRoot:
    "/sitecore/content/sandbox-collection/sandbox/Presentation/Available Renderings",
  headlessVariantsRoot:
    "/sitecore/content/sandbox-collection/sandbox/Presentation/Headless Variants",
  contentItemsRoot: "/sitecore/content/sandbox-collection/sandbox/Data",
};

const fakeRemoteItem = (path: string, itemId: string): RemoteItem => ({
  itemId,
  templateId: "00000000-0000-0000-0000-000000000000",
  parentId: "00000000-0000-0000-0000-000000000001",
  name: path.split("/").pop()!,
  path,
  fields: [],
});

/**
 * Build a fake AuthoringApiClient that resolves the named paths to
 * remote items and reports everything else as missing. Captures every
 * delete call so the test can assert exactly which items the prune
 * loop touched.
 */
const makeClient = (
  presentPaths: string[]
): AuthoringApiClient & {
  deletes: ItemSelector[];
} => {
  const presentMap = new Map<string, RemoteItem>(
    presentPaths.map((p, idx) => [
      p,
      fakeRemoteItem(p, `aaaaaaaa-aaaa-aaaa-aaaa-${String(idx).padStart(12, "0")}`),
    ])
  );
  const deletes: ItemSelector[] = [];
  return {
    deletes,
    getItem: async (selector) => {
      if (selector.path && presentMap.has(selector.path)) {
        return presentMap.get(selector.path)!;
      }
      return null;
    },
    getItemsByPaths: async (paths) => {
      const result = new Map<string, RemoteItem | null>();
      for (const p of paths) {
        result.set(p, presentMap.get(p) ?? null);
      }
      return result;
    },
    getChildren: async () => [],
    createItem: vi.fn(async () => ({ itemId: "unused" })),
    updateItem: vi.fn(async () => {}),
    deleteItem: vi.fn(async (selector: ItemSelector) => {
      deletes.push(selector);
    }),
  };
};

describe("pruneDefaultsAgainstClient", () => {
  it("deletes the SXA OOTB Available Renderings + Headless Variants + Data children that exist", async () => {
    const presentPaths = [
      `${ROOTS.availableRenderingsRoot}/Media`,
      `${ROOTS.availableRenderingsRoot}/Page Content`,
      `${ROOTS.headlessVariantsRoot}/Image`,
      `${ROOTS.headlessVariantsRoot}/Title`,
      `${ROOTS.contentItemsRoot}/Promos`,
      `${ROOTS.contentItemsRoot}/Texts`,
    ];
    const client = makeClient(presentPaths);

    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });

    // 4 SXA AR children + 7 SXA HV children + 5 Data children = 16 targets.
    expect(actions).toHaveLength(16);
    const deleted = actions.filter((a: PruneAction) => a.status === "deleted");
    expect(deleted.map((a) => a.path).sort()).toEqual(presentPaths.sort());
    const missing = actions.filter((a) => a.status === "missing");
    expect(missing.map((a) => a.path)).toContain(`${ROOTS.availableRenderingsRoot}/Navigation`);
    expect(missing.map((a) => a.path)).toContain(`${ROOTS.headlessVariantsRoot}/LinkList`);
    expect(missing.map((a) => a.path)).toContain(`${ROOTS.contentItemsRoot}/Images`);
    expect(client.deletes).toHaveLength(presentPaths.length);
    // Deletes go by itemId so we don't re-resolve the path inside the
    // mutation.
    expect(client.deletes.every((d) => Boolean(d.itemId) && !d.path)).toBe(true);
  });

  it("preserves the parent folders (no delete call hits Available Renderings, Headless Variants, or Data)", async () => {
    // Even if the parents *did* somehow show up as targets, the test
    // would fail — but more importantly, this asserts the build list
    // never mints the parent paths themselves.
    const client = makeClient([
      ROOTS.availableRenderingsRoot,
      ROOTS.headlessVariantsRoot,
      ROOTS.contentItemsRoot,
    ]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    expect(actions.every((a) => a.path !== ROOTS.availableRenderingsRoot)).toBe(true);
    expect(actions.every((a) => a.path !== ROOTS.headlessVariantsRoot)).toBe(true);
    expect(actions.every((a) => a.path !== ROOTS.contentItemsRoot)).toBe(true);
    expect(client.deletes).toHaveLength(0);
  });

  it("preserves Tags under Data (never lists it as a target)", async () => {
    const client = makeClient([`${ROOTS.contentItemsRoot}/Tags`]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    const targetedNames = actions
      .filter((a) => a.group === "contentItems")
      .map((a) => a.path.split("/").pop()!);
    expect(targetedNames).not.toContain("Tags");
    expect(client.deletes).toHaveLength(0);
  });

  it("keeps FEaaS and Forms in Available Renderings (never lists them as targets)", async () => {
    const client = makeClient([
      `${ROOTS.availableRenderingsRoot}/FEaaS`,
      `${ROOTS.availableRenderingsRoot}/Forms`,
    ]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    const targetedNames = actions
      .filter((a) => a.group === "availableRenderings")
      .map((a) => a.path.split("/").pop()!);
    expect(targetedNames).not.toContain("FEaaS");
    expect(targetedNames).not.toContain("Forms");
    expect(client.deletes).toHaveLength(0);
  });

  it("is idempotent — every target reports as missing on a clean tenant", async () => {
    const client = makeClient([]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    expect(actions.every((a) => a.status === "missing")).toBe(true);
    expect(client.deletes).toHaveLength(0);
  });

  it("treats a between-getItem-and-deleteItem race as missing (concurrent prune / author cleanup)", async () => {
    // Simulate the TOCTOU window: getItem resolves the item, but by the
    // time deleteItem hits the Authoring API the item is gone (another
    // prune ran in parallel, or an author deleted it). The Authoring
    // GraphQL response carries the canonical "was not found ... may have
    // been deleted by another user" message, wrapped by graphql.ts as a
    // NETWORK ScaiError. The prune loop should report this as `missing`
    // and continue rather than abort the whole task.
    const presentPaths = [
      `${ROOTS.availableRenderingsRoot}/Media`,
      `${ROOTS.headlessVariantsRoot}/Image`,
    ];
    const client = makeClient(presentPaths);
    const racedPath = `${ROOTS.availableRenderingsRoot}/Media`;
    const racedItemId = (await client.getItem({ path: racedPath }))!.itemId;
    const realDelete = client.deleteItem;
    client.deleteItem = vi.fn(async (selector: ItemSelector) => {
      if (selector.itemId === racedItemId) {
        throw new Error(
          `Authoring GraphQL errors: The item "${selector.itemId}" was not found.\n\nIt may have been deleted by another user.`
        );
      }
      return realDelete(selector);
    });

    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });

    const racedAction = actions.find((a: PruneAction) => a.path === racedPath)!;
    expect(racedAction.status).toBe("missing");
    expect(racedAction.itemId).toBeDefined();
    const otherDeleted = actions.find(
      (a: PruneAction) => a.path === `${ROOTS.headlessVariantsRoot}/Image`
    )!;
    expect(otherDeleted.status).toBe("deleted");
  });

  it("re-throws non-not-found delete errors", async () => {
    const client = makeClient([`${ROOTS.availableRenderingsRoot}/Media`]);
    client.deleteItem = vi.fn(async () => {
      throw new Error("Authoring GraphQL errors: Internal server error");
    });
    await expect(pruneDefaultsAgainstClient({ client, ...ROOTS, whatIf: false })).rejects.toThrow(
      /Internal server error/
    );
  });

  it("dry-run reports would-delete actions and skips deleteItem", async () => {
    const presentPaths = [
      `${ROOTS.availableRenderingsRoot}/Media`,
      `${ROOTS.headlessVariantsRoot}/Image`,
    ];
    const client = makeClient(presentPaths);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: true,
    });
    const wouldDelete = actions.filter((a) => a.status === "would-delete");
    expect(wouldDelete.map((a) => a.path).sort()).toEqual(presentPaths.sort());
    expect(client.deletes).toHaveLength(0);
    // dry-run still captures the resolved itemIds so a follow-up apply
    // doesn't have to re-resolve them.
    expect(wouldDelete.every((a) => Boolean(a.itemId))).toBe(true);
  });

  it("strips trailing slashes from root paths", async () => {
    const trailingClient = makeClient([`${ROOTS.availableRenderingsRoot}/Media`]);
    const actions = await pruneDefaultsAgainstClient({
      client: trailingClient,
      availableRenderingsRoot: `${ROOTS.availableRenderingsRoot}/`,
      headlessVariantsRoot: `${ROOTS.headlessVariantsRoot}/`,
      contentItemsRoot: `${ROOTS.contentItemsRoot}/`,
      whatIf: false,
    });
    // First targeted AR path should be `<root>/Media` (no double slash).
    const firstAr = actions.find((a) => a.group === "availableRenderings")!;
    expect(firstAr.path).toBe(`${ROOTS.availableRenderingsRoot}/Media`);
    expect(actions.find((a) => a.path.includes("//"))).toBeUndefined();
  });
});
