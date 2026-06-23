import { describe, it, expect, vi } from "vitest";
import type { AuthoringApiClient } from "../../../src/recipe/api/client";
import {
  DEFAULT_SAMPLE_PROJECT,
  pruneSampleAgainstClient,
  sampleProjectRoots,
} from "../../../src/recipe/tasks/prune-sample";

describe("sampleProjectRoots", () => {
  it("targets the four system subtrees for a project", () => {
    expect(sampleProjectRoots(DEFAULT_SAMPLE_PROJECT).map((t) => t.path)).toEqual([
      "/sitecore/templates/Branches/Project/click-click-launch",
      "/sitecore/templates/Project/click-click-launch",
      "/sitecore/layout/Renderings/Project/click-click-launch",
      "/sitecore/layout/Placeholder Settings/click-click-launch",
    ]);
  });
});

describe("pruneSampleAgainstClient", () => {
  const makeClient = (present: ReadonlySet<string>) => {
    const deleteItem = vi.fn(async () => undefined);
    const client = {
      getItem: vi.fn(async (selector: { path?: string }) =>
        selector.path && present.has(selector.path) ? { itemId: `id:${selector.path}` } : null
      ),
      deleteItem,
    } as unknown as AuthoringApiClient;
    return { client, deleteItem };
  };

  it("dry-run marks present roots would-delete and deletes nothing", async () => {
    const { client, deleteItem } = makeClient(
      new Set(["/sitecore/templates/Project/click-click-launch"])
    );
    const actions = await pruneSampleAgainstClient({
      client,
      project: DEFAULT_SAMPLE_PROJECT,
      whatIf: true,
    });
    expect(deleteItem).not.toHaveBeenCalled();
    expect(actions.filter((a) => a.status === "would-delete")).toHaveLength(1);
    expect(actions.filter((a) => a.status === "missing")).toHaveLength(3);
  });

  it("deletes present roots by itemId and skips missing ones", async () => {
    const { client, deleteItem } = makeClient(
      new Set([
        "/sitecore/templates/Project/click-click-launch",
        "/sitecore/layout/Renderings/Project/click-click-launch",
      ])
    );
    const actions = await pruneSampleAgainstClient({
      client,
      project: DEFAULT_SAMPLE_PROJECT,
      whatIf: false,
    });
    expect(deleteItem).toHaveBeenCalledTimes(2);
    expect(deleteItem).toHaveBeenCalledWith({
      itemId: "id:/sitecore/templates/Project/click-click-launch",
    });
    expect(actions.filter((a) => a.status === "deleted")).toHaveLength(2);
    expect(actions.filter((a) => a.status === "missing")).toHaveLength(2);
  });
});
