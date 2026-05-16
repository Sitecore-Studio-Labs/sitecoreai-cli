import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFieldFilterSet } from "../../../src/serialization/field-filter";
import type { EnvironmentConfiguration } from "../../../src/config/types";

const runGraphQL = vi.fn();

vi.mock("../../../src/serialization/api/graphql", () => ({
  runGraphQL: (...args: unknown[]) => runGraphQL(...args),
}));

describe("sitecore api items", () => {
  const env = { name: "demo" } as EnvironmentConfiguration;
  const filter = createFieldFilterSet([], []);

  beforeEach(() => {
    runGraphQL.mockReset();
  });

  it("maps scopes and debug signatures in metadata queries", async () => {
    const { fetchItemMetadata } = await import("../../../src/serialization/api/items");

    runGraphQL.mockResolvedValueOnce({
      serialize: [
        {
          id: "id-1",
          parentId: "parent-1",
          templateId: "template-1",
          path: "/sitecore/content/home",
          hasChildren: false,
          dataSignature: "sig",
        },
      ],
    });
    await fetchItemMetadata(env, "master", "/sitecore/content", "singleItem", filter, false);
    let [, query, variables] = runGraphQL.mock.calls[0];
    expect(variables.scope).toBe("SingleItem");
    expect(String(query)).toContain("dataSignature");
    expect(String(query)).not.toContain("dataSignature(debug: true)");

    runGraphQL.mockResolvedValueOnce({
      serialize: [
        {
          id: "id-2",
          parentId: "parent-1",
          templateId: "template-1",
          path: "/sitecore/content/home",
          hasChildren: false,
          dataSignature: "sig",
        },
      ],
    });
    await fetchItemMetadata(env, "master", "/sitecore/content", "itemAndChildren", filter, true);
    [, query, variables] = runGraphQL.mock.calls[1];
    expect(variables.scope).toBe("ItemAndChildren");
    expect(String(query)).toContain("dataSignature(debug: true)");

    runGraphQL.mockResolvedValueOnce({
      serialize: [
        {
          id: "id-3",
          parentId: "parent-1",
          templateId: "template-1",
          path: "/sitecore/content/home",
          hasChildren: false,
          dataSignature: "sig",
        },
      ],
    });
    await fetchItemMetadata(env, "master", "/sitecore/content", "descendantsOnly", filter, false);
    [, , variables] = runGraphQL.mock.calls[2];
    expect(variables.scope).toBe("DescendantsOnly");

    runGraphQL.mockResolvedValueOnce({
      serialize: [
        {
          id: "id-4",
          parentId: "parent-1",
          templateId: "template-1",
          path: "/sitecore/content/home",
          hasChildren: false,
          dataSignature: "sig",
        },
      ],
    });
    await fetchItemMetadata(env, "master", "/sitecore/content", "unknown", filter, false);
    [, , variables] = runGraphQL.mock.calls[3];
    expect(variables.scope).toBe("ItemAndDescendants");
  });

  it("parses item data and derives missing signatures", async () => {
    const { fetchItemData } = await import("../../../src/serialization/api/items");
    const rawItem = {
      id: "id-1",
      parentId: "parent-1",
      templateId: "template-1",
      path: "/sitecore/content/home",
      name: "home",
      branchId: null,
      sharedFields: [
        {
          fieldId: "field-1",
          nameHint: "Title",
          value: "value",
          blobId: null,
        },
      ],
      unversionedFields: [
        {
          language: "en",
          fields: [
            {
              fieldId: "field-2",
              nameHint: "Subtitle",
              value: "value",
              blobId: null,
            },
          ],
        },
      ],
      versions: [
        {
          language: "en",
          version: 1,
          fields: [
            {
              fieldId: "field-3",
              nameHint: "Body",
              value: "value",
              blobId: null,
            },
          ],
        },
      ],
      dataSignature: "",
    };

    runGraphQL.mockResolvedValueOnce({ serialize: [{ data: JSON.stringify(rawItem) }] });
    const data = await fetchItemData(env, "master", "/sitecore/content", "singleItem", filter);
    expect(data[0].dataSignature).toBeTruthy();
  });

  it("preserves existing signatures", async () => {
    const { fetchItemData } = await import("../../../src/serialization/api/items");
    const rawItem = {
      id: "id-2",
      parentId: "parent-1",
      templateId: "template-1",
      path: "/sitecore/content/home",
      name: "home",
      branchId: null,
      sharedFields: [],
      unversionedFields: [],
      versions: [],
      dataSignature: "sig",
    };

    runGraphQL.mockResolvedValueOnce({ serialize: [{ data: JSON.stringify(rawItem) }] });
    const data = await fetchItemData(env, "master", "/sitecore/content", "singleItem", filter);
    expect(data[0].dataSignature).toBe("sig");
  });

  it("throws when item data is missing from GraphQL responses", async () => {
    const { fetchItemData } = await import("../../../src/serialization/api/items");
    runGraphQL.mockResolvedValueOnce({ serialize: [{ data: 123 }] });
    await expect(
      fetchItemData(env, "master", "/sitecore/content", "singleItem", filter)
    ).rejects.toThrow("GraphQL response did not contain serialized item data.");
  });

  it("executes serialization commands via GraphQL", async () => {
    const { executeSerializationCommands } =
      await import("../../../src/serialization/api/items");
    runGraphQL.mockResolvedValueOnce({ executeSerializationCommands: [{ ok: true }] });
    const result = await executeSerializationCommands(env, [{ command: "noop" }], "Information");
    expect(result).toEqual([{ ok: true }]);
  });
});
