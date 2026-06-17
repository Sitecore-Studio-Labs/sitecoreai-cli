import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config/types";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/auth/client-credentials", () => ({
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

  it("falls back to the supplied path when the response omits it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "x",
            path: null,
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
    const wf = await client.getItemWorkflow("x", "/fallback/path");
    expect(wf?.path).toBe("/fallback/path");
  });
});

describe("hygiene client — itemExists / itemsExistBatch", () => {
  it("itemExists returns true when the item resolves", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: { itemId: "x" } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.itemExists("x")).toBe(true);
  });

  it("itemExists returns false when the item is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.itemExists("missing")).toBe(false);
  });

  it("itemsExistBatch aliases each id and maps presence to a boolean", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { i0: { itemId: "a" }, i1: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const result = await client.itemsExistBatch(["a", "b"]);

    expect(result.get("a")).toBe(true);
    expect(result.get("b")).toBe(false);
    expect(lastFetchBody(fetchMock).query).toContain("i0: item(where: { itemId: $id0 })");
  });

  it("itemsExistBatch short-circuits for an empty batch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect((await client.itemsExistBatch([])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("hygiene client — searchAll pagination", () => {
  it("yields all pages serially until a short page", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          okResponse({
            data: {
              search: {
                totalCount: 3,
                results: [
                  { itemId: "i1", path: "/p1", name: "i1" },
                  { itemId: "i2", path: "/p2", name: "i2" },
                ],
              },
            },
          })
        );
      }
      return Promise.resolve(
        okResponse({
          data: { search: { totalCount: 3, results: [{ itemId: "i3", path: "/p3", name: "i3" }] } },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const ids: string[] = [];
    for await (const r of client.searchAll({ paging: { pageSize: 2 } })) ids.push(r.itemId);

    expect(ids).toEqual(["i1", "i2", "i3"]);
  });

  it("returns after the first page when totalCount fits one page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { search: { totalCount: 1, results: [{ itemId: "i1", path: "/p1", name: "i1" }] } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const ids: string[] = [];
    for await (const r of client.searchAll({ paging: { pageSize: 100 } })) ids.push(r.itemId);

    expect(ids).toEqual(["i1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("hygiene client — getChildren", () => {
  it("throws INPUT_INVALID when neither itemId nor path is supplied", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.getChildren({})).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("maps child nodes by path selector", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            children: {
              nodes: [
                { itemId: "c1", name: "Child", path: "/p/c1", template: { templateId: "t1" } },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const children = await client.getChildren({ path: "/p" });
    expect(children).toEqual([
      { itemId: "c1", name: "Child", path: "/p/c1", templateId: "t1", templateName: null },
    ]);
  });

  it("returns an empty array when the parent item is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.getChildren({ itemId: "missing" })).toEqual([]);
  });
});

describe("hygiene client — deleteItem", () => {
  it("posts the delete mutation with permanently=true by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItem({ itemId: "x" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { itemId: "x", database: "master", permanently: true },
    });
  });

  it("throws UNKNOWN when the API returns successful=false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteItem({ itemId: "x" })).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("throws INPUT_INVALID when neither itemId nor path is supplied", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteItem({})).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("hygiene client — deleteItemTemplate", () => {
  it("posts the template-delete mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItemTemplate: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItemTemplate("tmpl-1");

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { templateId: "tmpl-1", database: "master" },
    });
  });

  it("throws UNKNOWN when successful=false (items still derive from it)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItemTemplate: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteItemTemplate("tmpl-1")).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});

describe("hygiene client — archiveVersion", () => {
  it("returns the archive version id on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { archiveVersion: { archiveVersionId: "av-1" } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const id = await client.archiveVersion({ itemId: "x", language: "en", version: 2 });
    expect(id).toBe("av-1");
  });

  it("throws INPUT_INVALID when neither itemId nor itemPath is supplied", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(
      client.archiveVersion({ language: "en", version: 1 } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("hygiene client — updateItemFields", () => {
  it("no-ops without a wire call when the field list is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.updateItemFields({ itemId: "x", fields: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the update mutation with the field list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { updateItem: { item: { itemId: "x" } } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.updateItemFields({ itemId: "x", fields: [{ name: "Title", value: "New" }] });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { itemId: "x", fields: [{ name: "Title", value: "New" }] },
    });
  });

  it("throws UNKNOWN when the mutation returns no itemId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { updateItem: { item: null } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(
      client.updateItemFields({ itemId: "x", fields: [{ name: "T", value: "v" }] })
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});

describe("hygiene client — renameItem", () => {
  it("rejects names containing a slash", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.renameItem({ itemId: "x", name: "a/b" })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("rejects a blank name", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.renameItem({ itemId: "x", name: "  " })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("posts the update mutation with the new name", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { updateItem: { item: { itemId: "x" } } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.renameItem({ itemId: "x", name: "Renamed" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { itemId: "x", name: "Renamed" },
    });
  });
});

describe("hygiene client — addItemVersion", () => {
  it("returns the new version number on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: { addItemVersion: { item: { itemId: "x" }, versionNumber: 4 } } })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const result = await client.addItemVersion({ itemId: "x", language: "fr" });
    expect(result).toEqual({ versionNumber: 4 });
  });

  it("throws INPUT_INVALID when language is missing", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.addItemVersion({ itemId: "x", language: "" })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("hygiene client — listUsers / listRoles", () => {
  it("listUsers pages through users until hasNextPage is false", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          okResponse({
            data: {
              users: {
                nodes: [
                  {
                    name: "alice",
                    isAdministrator: true,
                    isAuthenticated: true,
                    domain: { name: "sitecore" },
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: "cur-1" },
              },
            },
          })
        );
      }
      return Promise.resolve(
        okResponse({
          data: {
            users: {
              nodes: [
                { name: "bob", isAdministrator: false, isAuthenticated: false, domain: null },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const users = await client.listUsers();

    expect(users.map((u) => u.name)).toEqual(["alice", "bob"]);
    expect(users[0]).toMatchObject({ isAdministrator: true, domain: "sitecore" });
    expect(users[1].domain).toBeNull();
  });

  it("listRoles maps member sampling to a memberCount signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          roles: {
            nodes: [
              {
                name: "Authors",
                domain: { name: "sitecore" },
                members: { nodes: [{ name: "x" }] },
              },
              { name: "Empty", domain: null, members: { nodes: [] } },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const roles = await client.listRoles();

    expect(roles).toEqual([
      { name: "Authors", domain: "sitecore", memberCount: 1 },
      { name: "Empty", domain: null, memberCount: 0 },
    ]);
  });
});

describe("hygiene client — getUserDetail", () => {
  it("flattens the user profile into roles + activity dates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          user: {
            name: "alice",
            isAdministrator: false,
            roles: [{ name: "Authors" }],
            profile: { lastLoginDate: "2026-01-01", lastActivityDate: "2026-02-01" },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const detail = await client.getUserDetail("alice");
    expect(detail).toEqual({
      name: "alice",
      isAdministrator: false,
      roles: ["Authors"],
      lastLogin: "2026-01-01",
      lastActivity: "2026-02-01",
    });
  });

  it("returns null when the user does not exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { user: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.getUserDetail("ghost")).toBeNull();
  });
});

describe("hygiene client — deleteUser / deleteRole", () => {
  it("deleteUser succeeds when successful=true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteUser: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteUser("alice");
    expect(lastFetchBody(fetchMock).variables).toMatchObject({ input: { userName: "alice" } });
  });

  it("deleteUser throws UNKNOWN when successful=false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteUser: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteUser("alice")).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("deleteRole throws UNKNOWN when successful=false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteRole: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteRole("Authors")).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});

describe("hygiene client — listItemTemplates root scoping", () => {
  it("resolves the root by exact path, not results[0], and scopes by path prefix", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // _fullpath lookup — the index ranks a shallower near-match
        // first; the exact match is later in the page.
        return Promise.resolve(
          okResponse({
            data: {
              search: {
                totalCount: 2,
                results: [
                  { itemId: "shallow", path: "/sitecore/templates/project", name: "project" },
                  {
                    itemId: "root-id",
                    path: "/sitecore/templates/project/site/components",
                    name: "components",
                  },
                ],
              },
            },
          })
        );
      }
      // searchAll _template page — the _path CONTAINS substring filter
      // over-matches templates outside the requested root.
      return Promise.resolve(
        okResponse({
          data: {
            search: {
              totalCount: 3,
              results: [
                {
                  itemId: "t1",
                  path: "/sitecore/templates/Project/site/components/Hero",
                  name: "Hero",
                },
                {
                  itemId: "t2",
                  path: "/sitecore/templates/Project/othersite/Card",
                  name: "Card",
                },
                { itemId: "t3", path: "/sitecore/templates/Foundation/Other", name: "Other" },
              ],
            },
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const templates = await client.listItemTemplates({
      rootPath: "/sitecore/templates/Project/site/components",
    });

    // Exact resolution scopes to the components folder — `Card` (a
    // sibling-site template the index over-matched) and `Other` are
    // dropped. Trusting results[0] would have kept `Card`.
    expect(templates.map((t) => t.name)).toEqual(["Hero"]);
  });

  it("throws INPUT_INVALID when the root path does not resolve", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { search: { totalCount: 0, results: [] } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(
      client.listItemTemplates({ rootPath: "/sitecore/templates/Project/missing" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
