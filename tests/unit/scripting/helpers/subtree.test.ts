import { describe, expect, it, vi } from "vitest";
import { move } from "../../../../src/scripting/helpers/subtree";
import type { ScaiClient } from "../../../../src/scripting/connect";

/**
 * Unit tests for the subtree helper. Covers input validation (the
 * exactly-one selector rules on both ends), both not-found branches, the
 * already-under-target no-op, and the dry-run / apply fork.
 *
 * The `ScaiClient.authoring` surface is mocked — no network, no real
 * Authoring API call.
 */

type Item = { itemId: string; path?: string };

const makeClient = (
  resolve: (selector: { itemId?: string; path?: string }) => Item | null
): {
  client: ScaiClient;
  getItem: ReturnType<typeof vi.fn>;
  moveItem: ReturnType<typeof vi.fn>;
} => {
  const getItem = vi.fn(async (selector: { itemId?: string; path?: string }) => resolve(selector));
  const moveItem = vi.fn().mockResolvedValue(undefined);
  const client = { authoring: { getItem, moveItem } } as unknown as ScaiClient;
  return { client, getItem, moveItem };
};

const SOURCE: Item = { itemId: "src-1", path: "/sitecore/content/Site/Old/Page" };
const TARGET: Item = { itemId: "dst-1", path: "/sitecore/content/Site/Archive" };

/** Sitecore resolves paths case-insensitively; the mocks mirror that. */
const samePath = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

const bothResolve = (selector: { itemId?: string; path?: string }): Item | null => {
  if (selector.itemId === SOURCE.itemId || samePath(selector.path, SOURCE.path)) return SOURCE;
  if (selector.itemId === TARGET.itemId || samePath(selector.path, TARGET.path)) return TARGET;
  return null;
};

describe("subtree.move — input validation", () => {
  it("rejects a source with both itemId and path", async () => {
    const { client } = makeClient(bothResolve);
    await expect(
      move(client, { itemId: "a", path: "/b", toItemId: TARGET.itemId })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects a source with neither itemId nor path", async () => {
    const { client } = makeClient(bothResolve);
    await expect(move(client, { toItemId: TARGET.itemId })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("rejects a destination with both toItemId and toPath", async () => {
    const { client } = makeClient(bothResolve);
    await expect(
      move(client, { itemId: SOURCE.itemId, toItemId: "a", toPath: "/b" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects a destination with neither toItemId nor toPath", async () => {
    const { client } = makeClient(bothResolve);
    await expect(move(client, { itemId: SOURCE.itemId })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("validates before making any wire call", async () => {
    const { client, getItem } = makeClient(bothResolve);
    await expect(move(client, {})).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("subtree.move — resolution failures", () => {
  it("throws INPUT_INVALID naming the source when it does not resolve", async () => {
    const { client, moveItem } = makeClient((s) => (s.path === TARGET.path ? TARGET : null));
    await expect(
      move(client, { path: "/sitecore/content/Nope", toPath: TARGET.path, allowWrite: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(moveItem).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID naming the target when it does not resolve", async () => {
    const { client, moveItem } = makeClient((s) => (s.path === SOURCE.path ? SOURCE : null));
    await expect(
      move(client, { path: SOURCE.path, toPath: "/sitecore/content/Nope", allowWrite: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(moveItem).not.toHaveBeenCalled();
  });
});

describe("subtree.move — dry-run vs apply", () => {
  it("defaults to a dry run: resolves both ends, makes no wire call", async () => {
    const { client, moveItem } = makeClient(bothResolve);
    const result = await move(client, { path: SOURCE.path, toPath: TARGET.path });

    expect(result).toMatchObject({
      itemId: SOURCE.itemId,
      from: SOURCE.path,
      toParent: { itemId: TARGET.itemId, path: TARGET.path },
      changed: true,
      applied: false,
    });
    expect(moveItem).not.toHaveBeenCalled();
  });

  it("applies the move when allowWrite is set, preserving the itemId", async () => {
    const { client, moveItem } = makeClient(bothResolve);
    const result = await move(client, {
      path: SOURCE.path,
      toPath: TARGET.path,
      allowWrite: true,
    });

    expect(result).toMatchObject({ itemId: SOURCE.itemId, changed: true, applied: true });
    expect(moveItem).toHaveBeenCalledWith({
      selector: { path: SOURCE.path },
      targetParent: { path: TARGET.path },
    });
  });

  it("passes itemId selectors straight through", async () => {
    const { client, moveItem } = makeClient(bothResolve);
    await move(client, { itemId: SOURCE.itemId, toItemId: TARGET.itemId, allowWrite: true });

    expect(moveItem).toHaveBeenCalledWith({
      selector: { itemId: SOURCE.itemId },
      targetParent: { itemId: TARGET.itemId },
    });
  });
});

describe("subtree.move — no-op detection", () => {
  const CHILD: Item = { itemId: "src-2", path: "/sitecore/content/Site/Archive/Page" };

  const resolveChild = (selector: { itemId?: string; path?: string }): Item | null => {
    if (selector.itemId === CHILD.itemId || samePath(selector.path, CHILD.path)) return CHILD;
    if (selector.itemId === TARGET.itemId || samePath(selector.path, TARGET.path)) return TARGET;
    return null;
  };

  it("reports changed: false when the item already sits under the target parent", async () => {
    const { client, moveItem } = makeClient(resolveChild);
    const result = await move(client, {
      path: CHILD.path,
      toPath: TARGET.path,
      allowWrite: true,
    });

    expect(result).toMatchObject({ changed: false, applied: false });
    expect(moveItem).not.toHaveBeenCalled();
  });

  it("compares parent paths case-insensitively", async () => {
    const { client, moveItem } = makeClient(resolveChild);
    const result = await move(client, {
      path: CHILD.path,
      toPath: "/SITECORE/CONTENT/Site/ARCHIVE",
      allowWrite: true,
    });

    expect(result.changed).toBe(false);
    expect(moveItem).not.toHaveBeenCalled();
  });
});
