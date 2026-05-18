import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the bounded-depth tree walk in `runContentBrowse`: direct
 * children at depth 1, recursion to the requested depth, the empty-path
 * case, and depth clamping. Tenant resolution and the perf knobs are
 * mocked; `mapWithConcurrency` runs for real.
 */
const mocks = vi.hoisted(() => ({
  resolveTenant: vi.fn(),
  resolveHygieneKnobs: vi.fn(() => ({ concurrency: 4 })),
  getChildren: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/shared", () => ({
  resolveTenant: mocks.resolveTenant,
  resolveHygieneKnobs: mocks.resolveHygieneKnobs,
}));

const { runContentBrowse, MAX_BROWSE_DEPTH } = await import("../../../../src/hygiene/tasks/browse");

const child = (id: string, name: string, path: string) => ({
  itemId: id,
  name,
  path,
  templateId: "tpl",
  templateName: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveHygieneKnobs.mockReturnValue({ concurrency: 4 });
  mocks.resolveTenant.mockReturnValue({
    envName: "demo",
    environment: {},
    root: {},
    client: { getChildren: mocks.getChildren },
  });
});

describe("runContentBrowse", () => {
  it("returns direct children at depth 1 without recursing", async () => {
    mocks.getChildren.mockResolvedValue([
      child("a", "Alpha", "/sitecore/templates/Project/Alpha"),
      child("b", "Beta", "/sitecore/templates/Project/Beta"),
    ]);
    const result = await runContentBrowse({ path: "/sitecore/templates/Project", depth: 1 });
    expect(result.totalCount).toBe(2);
    expect(result.depth).toBe(1);
    expect(result.nodes.map((node) => node.name)).toEqual(["Alpha", "Beta"]);
    expect(result.nodes[0].children).toBeUndefined();
    expect(mocks.getChildren).toHaveBeenCalledTimes(1);
    expect(mocks.getChildren).toHaveBeenCalledWith({ path: "/sitecore/templates/Project" });
  });

  it("recurses to the requested depth", async () => {
    mocks.getChildren.mockImplementation((selector: { path?: string; itemId?: string }) => {
      if (selector.path) return Promise.resolve([child("a", "Alpha", "/p/Alpha")]);
      if (selector.itemId === "a") {
        return Promise.resolve([child("a1", "Alpha-1", "/p/Alpha/Alpha-1")]);
      }
      return Promise.resolve([]);
    });
    const result = await runContentBrowse({ path: "/p", depth: 2 });
    expect(result.totalCount).toBe(2);
    expect(result.nodes[0].children?.[0].name).toBe("Alpha-1");
    // The grandchild is at the depth limit — its own children are not fetched.
    expect(result.nodes[0].children?.[0].children).toBeUndefined();
  });

  it("returns an empty tree for a path with no children", async () => {
    mocks.getChildren.mockResolvedValue([]);
    const result = await runContentBrowse({ path: "/nope", depth: 3 });
    expect(result.nodes).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("clamps depth to MAX_BROWSE_DEPTH", async () => {
    mocks.getChildren.mockResolvedValue([]);
    const result = await runContentBrowse({ path: "/p", depth: 99 });
    expect(result.depth).toBe(MAX_BROWSE_DEPTH);
  });
});
