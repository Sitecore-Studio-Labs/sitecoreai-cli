import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config/types";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/serialization/api/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

const baseEnv: EnvironmentConfiguration = {
  name: "test",
  host: "test.sitecorecloud.io",
  database: "master",
} as EnvironmentConfiguration;

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const lastFetchBody = (
  fetchMock: ReturnType<typeof vi.fn>
): { query: string; variables?: unknown } =>
  JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hygiene client — deleteItem", () => {
  it("posts deleteItem with permanently: true by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItem({ itemId: "abc" });
    const body = lastFetchBody(fetchMock);
    expect(body.variables).toMatchObject({
      input: { itemId: "abc", database: "master", permanently: true },
    });
  });

  it("respects permanently: false (sends to archive)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItem({ itemId: "abc", permanently: false });
    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { permanently: false },
    });
  });

  it("throws INPUT_INVALID when neither itemId nor path is provided", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteItem({} as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws UNKNOWN when successful=false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteItem({ itemId: "abc" })).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});

describe("hygiene client — deleteItemTemplate", () => {
  it("posts deleteItemTemplate with templateId + master default database", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItemTemplate: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItemTemplate("template-xyz");
    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { templateId: "template-xyz", database: "master" },
    });
  });
});

describe("hygiene client — deleteArchivedItem", () => {
  it("posts the archivalId; omits archiveName when not provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteArchivedItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteArchivedItem("archival-123");
    const body = lastFetchBody(fetchMock);
    expect(body.variables).toMatchObject({ input: { archivalId: "archival-123" } });
    expect(
      (body.variables as { input: { archiveName?: string } }).input.archiveName
    ).toBeUndefined();
  });

  it("includes archiveName when provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteArchivedItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteArchivedItem("archival-123", "myArchive");
    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { archivalId: "archival-123", archiveName: "myArchive" },
    });
  });
});

describe("hygiene client — archiveVersion", () => {
  it("returns the archiveVersionId from the response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { archiveVersion: { archiveVersionId: "av-xyz" } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    const id = await client.archiveVersion({
      itemId: "abc",
      language: "en",
      version: 2,
    });
    expect(id).toBe("av-xyz");
  });

  it("requires itemId or itemPath", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(
      client.archiveVersion({ language: "en", version: 1 } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("hygiene client — listItemTemplates", () => {
  it("uses search with _template filter to enumerate templates", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1;
      // First call: search for root path → return root
      if (calls === 1) {
        return Promise.resolve(
          okResponse({
            data: {
              search: {
                totalCount: 1,
                results: [{ itemId: "rootid", path: "/sitecore/templates/Project" }],
              },
            },
          })
        );
      }
      // Subsequent: searchAll → return templates then empty
      if (calls === 2) {
        return Promise.resolve(
          okResponse({
            data: {
              search: {
                totalCount: 2,
                results: [
                  {
                    itemId: "tpl-a",
                    name: "Hero",
                    path: "/sitecore/templates/Project/Foo/Hero",
                  },
                  {
                    itemId: "tpl-b",
                    name: "Card",
                    path: "/sitecore/templates/Project/Foo/Card",
                  },
                ],
              },
            },
          })
        );
      }
      return Promise.resolve(okResponse({ data: { search: { totalCount: 2, results: [] } } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    const result = await client.listItemTemplates({ rootPath: "/sitecore/templates/Project" });

    expect(result).toEqual([
      {
        templateId: "tpl-a",
        name: "Hero",
        fullName: "Project/Foo/Hero",
        standardValuesItemId: null,
      },
      {
        templateId: "tpl-b",
        name: "Card",
        fullName: "Project/Foo/Card",
        standardValuesItemId: null,
      },
    ]);
    // Confirm the second call's query uses the _template + _path AND statement.
    const secondCall = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondCall.query).toContain("operator: MUST");
    expect(secondCall.query).toContain('field: "_template"');
    expect(secondCall.query).toContain('field: "_path"');
  });

  it("throws INPUT_INVALID when the root path doesn't resolve", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { search: { totalCount: 0, results: [] } } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    // An unresolved --root used to return [] silently, which masked a
    // bad path as an empty subtree — it now fails loud.
    await expect(
      client.listItemTemplates({ rootPath: "/sitecore/templates/Nonexistent" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Regression: the search index returns the same template multiple times
  // when its `_path` covers multiple language/version index rows. On SXA
  // tenants the `Project` / `Experience Accelerator` base templates can
  // surface 4-5x each, which used to make `audit heavy-templates` and
  // `audit dead-templates` double-count. listItemTemplates dedupes by
  // templateId so every downstream audit sees one row per template.
  it("dedupes templates by templateId across paged results", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          okResponse({
            data: {
              search: {
                totalCount: 1,
                results: [{ itemId: "rootid", path: "/sitecore/templates/Project" }],
              },
            },
          })
        );
      }
      // Simulate the index returning the same template id 5 times.
      return Promise.resolve(
        okResponse({
          data: {
            search: {
              totalCount: 5,
              results: [
                { itemId: "dup-id", name: "Base", path: "/sitecore/templates/Project/Base" },
                { itemId: "dup-id", name: "Base", path: "/sitecore/templates/Project/Base" },
                { itemId: "dup-id", name: "Base", path: "/sitecore/templates/Project/Base" },
                { itemId: "dup-id", name: "Base", path: "/sitecore/templates/Project/Base" },
                { itemId: "dup-id", name: "Base", path: "/sitecore/templates/Project/Base" },
              ],
            },
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    const result = await client.listItemTemplates({ rootPath: "/sitecore/templates/Project" });
    expect(result).toHaveLength(1);
    expect(result[0].templateId).toBe("dup-id");
  });
});

describe("hygiene client — getChildren", () => {
  it("maps children with template.templateId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            children: {
              nodes: [
                {
                  itemId: "c1",
                  name: "A",
                  path: "/x/A",
                  template: { templateId: "t1" },
                },
                {
                  itemId: "c2",
                  name: "B",
                  path: "/x/B",
                  template: null,
                },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    const children = await client.getChildren({ path: "/x" });
    expect(children).toEqual([
      { itemId: "c1", name: "A", path: "/x/A", templateId: "t1", templateName: null },
      { itemId: "c2", name: "B", path: "/x/B", templateId: null, templateName: null },
    ]);
  });

  it("returns empty array for missing parent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHygieneApiClient({ environment: baseEnv });
    const children = await client.getChildren({ path: "/missing" });
    expect(children).toEqual([]);
  });
});
