import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/serialization/sitecore-api/auth", () => ({
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

describe("hygiene client — search wire shape", () => {
  it("inlines the query body and uses no variables (XM Cloud rejects enum vars)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { search: { totalCount: 0, results: [] } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.search({
      index: "sitecore_master_index",
      paging: { pageSize: 10 },
      searchStatement: {
        criteria: { field: "_path", value: "abc123", criteriaType: "CONTAINS" },
      },
    });

    const body = lastFetchBody(fetchMock);
    expect(body.variables).toBeUndefined();
    expect(body.query).toContain("search(query:");
    // Enum literal must NOT be quoted; field/value strings must be JSON-quoted.
    expect(body.query).toContain("criteriaType: CONTAINS");
    expect(body.query).toContain('field: "_path"');
    expect(body.query).toContain('value: "abc123"');
  });

  it("emits the operator enum as a bare token, not a string literal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { search: { totalCount: 0, results: [] } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.search({
      searchStatement: { operator: "MUST", subStatements: [] },
    });

    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("operator: MUST");
    expect(body.query).not.toContain('operator: "MUST"');
  });

  it("escapes user-controlled string values to prevent GraphQL injection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { search: { totalCount: 0, results: [] } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.search({
      searchStatement: {
        criteria: { field: "_name", value: 'evil"} ) { x } #', criteriaType: "EXACT" },
      },
    });

    const body = lastFetchBody(fetchMock);
    // JSON.stringify-escaped quotes must be preserved so the injection
    // never escapes the string literal.
    expect(body.query).toContain('value: "evil\\"} ) { x } #"');
  });

  it("uses the configured default index when none provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { search: { totalCount: 0, results: [] } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({
      environment: baseEnv,
      defaultIndex: "sitecore_web_index",
    });
    await client.search({});

    expect(lastFetchBody(fetchMock).query).toContain('index: "sitecore_web_index"');
  });
});

describe("hygiene client — archivedItems variant selection", () => {
  it("uses the no-name query shape when archiveName is not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { archivedItems: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.listArchivedItems();

    const body = lastFetchBody(fetchMock);
    expect(body.query).not.toContain("$archiveName");
    expect(body.variables).toMatchObject({ pageIndex: 0, pageSize: 100 });
  });

  it("uses the named-archive query shape when archiveName is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { archivedItems: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.listArchivedItems({ archiveName: "archive" });

    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("$archiveName: String!");
    expect(body.variables).toMatchObject({
      archiveName: "archive",
      pageIndex: 0,
      pageSize: 100,
    });
  });
});

describe("hygiene client — deleteItemVersion", () => {
  it("posts the delete mutation with itemId + language + version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItemVersion: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItemVersion({
      itemId: "abc-123",
      language: "en",
      version: 3,
    });

    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("deleteItemVersion(input: $input)");
    expect(body.variables).toMatchObject({
      input: { itemId: "abc-123", language: "en", version: 3, database: "master" },
    });
  });

  it("throws when the API returns successful=false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItemVersion: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(
      client.deleteItemVersion({ itemId: "abc", language: "en", version: 1 })
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("throws INPUT_INVALID when neither itemId nor path is supplied", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(
      client.deleteItemVersion({ language: "en", version: 1 } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("hygiene client — getItemFieldsBatch", () => {
  it("aliases multiple items into a single query (i0, i1, ...)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          i0: { itemId: "a", fields: { nodes: [] } },
          i1: { itemId: "b", fields: { nodes: [] } },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const result = await client.getItemFieldsBatch(["a", "b"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("i0: item(where: { itemId: $id0 })");
    expect(body.query).toContain("i1: item(where: { itemId: $id1 })");
    expect(body.variables).toMatchObject({ id0: "a", id1: "b" });
    expect(result.size).toBe(2);
  });

  it("returns an empty map for an empty batch without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const result = await client.getItemFieldsBatch([]);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("hygiene client — getItemVersions", () => {
  it("returns an empty array when item doesn't exist (item is null)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const versions = await client.getItemVersions({ itemId: "missing" });
    expect(versions).toEqual([]);
  });
});

describe("hygiene client — getItemWorkflow", () => {
  it("returns null when item has no workflow attached", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { item: { itemId: "x", path: "/sitecore/content/x", workflow: null } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const wf = await client.getItemWorkflow("x", "/sitecore/content/x");
    expect(wf).toBeNull();
  });

  it("flattens the nested ItemWorkflow response into a flat record", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "x",
            path: "/sitecore/content/x",
            workflow: {
              workflowState: { stateId: "s1", displayName: "Draft", final: false },
              workflow: { workflowId: "w1", displayName: "Basic" },
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const wf = await client.getItemWorkflow("x", "/sitecore/content/x");
    expect(wf).toEqual({
      itemId: "x",
      path: "/sitecore/content/x",
      workflowId: "w1",
      workflowName: "Basic",
      stateId: "s1",
      stateName: "Draft",
      stateIsFinal: false,
    });
  });
});
