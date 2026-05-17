import { describe, expect, it, vi } from "vitest";

// `publishItemSubtree` composes `fetchItemMetadata` + `publishItems`.
// `publishItems` lives in the same module, so it cannot be mocked
// directly — instead mock its transport (`runGraphQL`) and the metadata
// fetch, then exercise the real composition.
const mocks = vi.hoisted(() => ({
  fetchItemMetadata: vi.fn(),
  createFieldFilterSet: vi.fn().mockReturnValue({}),
  runGraphQL: vi.fn(),
}));

vi.mock("../../../src/serialization/api/items", () => ({
  fetchItemMetadata: mocks.fetchItemMetadata,
}));
vi.mock("../../../src/serialization/field-filter", () => ({
  createFieldFilterSet: mocks.createFieldFilterSet,
}));
vi.mock("../../../src/serialization/api/graphql", () => ({
  runGraphQL: mocks.runGraphQL,
}));

import { publishItemSubtree } from "../../../src/serialization/api/publish";

const env = { environmentId: "e-1" } as never;

describe("publishItemSubtree", () => {
  it("resolves descendant ids and submits one publish job", async () => {
    mocks.fetchItemMetadata.mockResolvedValueOnce([{ id: "{a}" }, { id: "{b}" }]);
    mocks.runGraphQL.mockResolvedValueOnce({
      publish: { id: "pub-1", processedCount: 2, stateName: "Completed" },
    });

    const result = await publishItemSubtree(env, "/sitecore/content/Home", { target: "web" });

    expect(result.itemCount).toBe(2);
    expect(result.database).toBe("master");
    expect(result.target).toBe("web");
    expect(result.job.id).toBe("pub-1");
    expect(mocks.runGraphQL).toHaveBeenCalledWith(
      env,
      expect.any(String),
      { itemIds: ["{a}", "{b}"], target: "web" },
      undefined
    );
  });

  it("throws when the path resolves to no items", async () => {
    mocks.fetchItemMetadata.mockResolvedValueOnce([]);
    await expect(publishItemSubtree(env, "/sitecore/content/Empty")).rejects.toThrow(
      /No items found/
    );
  });
});
