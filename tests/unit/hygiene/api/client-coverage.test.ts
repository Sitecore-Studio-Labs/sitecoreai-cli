/**
 * `src/hygiene/api/client.ts` — branch-coverage top-up.
 *
 * The wire shape of the big-ticket operations is already pinned by
 * `client.test.ts` and `client-extended.test.ts`. This file fills the
 * remaining branches: the `path`-selector arms of the read operations
 * (their siblings cover `itemId`), pagination-cursor termination,
 * absent-connection guards, and the path-form delete/archive mutations.
 */
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

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const lastFetchBody = (
  fetchMock: ReturnType<typeof vi.fn>
): { query: string; variables?: Record<string, unknown> } =>
  JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hygiene client — getItemFields path/itemId selector", () => {
  it("uses the by-id query and maps fields when an itemId is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "x",
            fields: {
              nodes: [
                {
                  name: "Title",
                  value: "Hi",
                  templateField: { templateFieldId: "tf-1" },
                },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const fields = await client.getItemFields({ itemId: "x" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({ itemId: "x" });
    expect(fields).toEqual([{ fieldId: "tf-1", name: "Title", value: "Hi" }]);
  });

  it("uses the by-path query when a path is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { item: { fields: { nodes: [] } } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const fields = await client.getItemFields({ path: "/sitecore/content/Home" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      path: "/sitecore/content/Home",
    });
    expect(fields).toEqual([]);
  });

  it("drops fields with no template-field id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            fields: {
              nodes: [
                { name: "Orphan", value: "v", templateField: null },
                { name: "Kept", value: "k", templateField: { templateFieldId: "tf-2" } },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const fields = await client.getItemFields({ itemId: "x" });
    expect(fields).toEqual([{ fieldId: "tf-2", name: "Kept", value: "k" }]);
  });

  it("returns null when the by-id item does not resolve", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.getItemFields({ itemId: "missing" })).toBeNull();
  });

  it("returns null when the by-path item does not resolve", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.getItemFields({ path: "/missing" })).toBeNull();
  });

  it("throws INPUT_INVALID when neither itemId nor path is supplied", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.getItemFields({})).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("hygiene client — getItemVersions path/itemId selector", () => {
  it("uses the by-id query and returns the version list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { item: { versions: [{ version: 1, language: "en" }] } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const versions = await client.getItemVersions({ itemId: "x", language: "en" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({ itemId: "x", language: "en" });
    expect(versions).toEqual([{ version: 1, language: "en" }]);
  });

  it("uses the by-path query and defaults language to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: { versions: [] } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.getItemVersions({ path: "/sitecore/content/Home" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      path: "/sitecore/content/Home",
      language: null,
    });
  });

  it("returns an empty array when the by-path item is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.getItemVersions({ path: "/missing" })).toEqual([]);
  });

  it("throws INPUT_INVALID when neither itemId nor path is supplied", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.getItemVersions({})).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("hygiene client — getChildren by itemId", () => {
  it("uses the by-id query when an itemId is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            children: {
              nodes: [{ itemId: "c1", name: "Child", path: "/p/c1", template: null }],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const children = await client.getChildren({ itemId: "p" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({ itemId: "p" });
    // template === null path → templateId falls back to null.
    expect(children).toEqual([
      { itemId: "c1", name: "Child", path: "/p/c1", templateId: null, templateName: null },
    ]);
  });
});

describe("hygiene client — deleteItemVersion / deleteItem path form", () => {
  it("deleteItemVersion sends a path payload when only a path is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItemVersion: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItemVersion({ path: "/sitecore/content/Home", language: "en", version: 2 });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { path: "/sitecore/content/Home", language: "en", version: 2, database: "master" },
    });
  });

  it("deleteItem sends a path payload when only a path is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteItem({ path: "/sitecore/content/Home" });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { path: "/sitecore/content/Home", permanently: true, database: "master" },
    });
  });
});

describe("hygiene client — archiveVersion itemPath form", () => {
  it("sends an itemPath payload when only itemPath is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { archiveVersion: { archiveVersionId: "av-9" } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const id = await client.archiveVersion({
      itemPath: "/sitecore/content/Home",
      language: "en",
      version: 1,
      archiveName: "recyclebin",
    });

    expect(id).toBe("av-9");
    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { itemPath: "/sitecore/content/Home", archiveName: "recyclebin" },
    });
  });

  it("returns null when the API omits an archiveVersionId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { archiveVersion: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const id = await client.archiveVersion({ itemId: "x", language: "en", version: 1 });
    expect(id).toBeNull();
  });
});

describe("hygiene client — renameItem / addItemVersion guards", () => {
  it("renameItem throws INPUT_INVALID when itemId is missing", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.renameItem({ name: "Ok" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("renameItem throws UNKNOWN when the mutation returns no itemId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { updateItem: { item: null } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.renameItem({ itemId: "x", name: "Ok" })).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });

  it("addItemVersion throws INPUT_INVALID when itemId is missing", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.addItemVersion({ language: "en" } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("addItemVersion forwards an explicit baseVersion as versionNumber", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: { addItemVersion: { item: { itemId: "x" }, versionNumber: 5 } } })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.addItemVersion({ itemId: "x", language: "en", baseVersion: 4 });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({
      input: { itemId: "x", language: "en", versionNumber: 4 },
    });
  });

  it("addItemVersion throws UNKNOWN when the mutation returns no itemId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { addItemVersion: { item: null } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.addItemVersion({ itemId: "x", language: "en" })).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});

describe("hygiene client — updateItemFields guards", () => {
  it("throws INPUT_INVALID when itemId is missing", async () => {
    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(
      client.updateItemFields({ fields: [{ name: "T", value: "v" }] } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("hygiene client — deleteArchivedItem", () => {
  it("throws UNKNOWN when the API returns successful=false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteArchivedItem: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await expect(client.deleteArchivedItem("arch-1")).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});

describe("hygiene client — listUsers / listRoles pagination edges", () => {
  it("listUsers stops when the users connection is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { users: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.listUsers()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("listUsers stops after one page when endCursor is null even if hasNextPage is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          users: {
            nodes: [{ name: "a", isAdministrator: false, isAuthenticated: true, domain: null }],
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const users = await client.listUsers();
    expect(users.map((u) => u.name)).toEqual(["a"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("listUsers sends the after cursor on the second page", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          okResponse({
            data: {
              users: {
                nodes: [{ name: "a", isAdministrator: false, isAuthenticated: true, domain: null }],
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
              nodes: [{ name: "b", isAdministrator: false, isAuthenticated: true, domain: null }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.listUsers({ pageSize: 1 });

    expect(lastFetchBody(fetchMock).variables).toMatchObject({ first: 1, after: "cur-1" });
  });

  it("listRoles stops when the roles connection is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { roles: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    expect(await client.listRoles()).toEqual([]);
  });

  it("listRoles paginates with the after cursor across pages", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          okResponse({
            data: {
              roles: {
                nodes: [{ name: "A", domain: null, members: { nodes: [] } }],
                pageInfo: { hasNextPage: true, endCursor: "rc-1" },
              },
            },
          })
        );
      }
      return Promise.resolve(
        okResponse({
          data: {
            roles: {
              nodes: [{ name: "B", domain: null, members: { nodes: [{ name: "m" }] } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const roles = await client.listRoles({ pageSize: 1 });

    expect(roles.map((r) => r.name)).toEqual(["A", "B"]);
    expect(lastFetchBody(fetchMock).variables).toMatchObject({ after: "rc-1" });
  });
});

describe("hygiene client — getUserDetail null-profile fallback", () => {
  it("defaults lastLogin/lastActivity to null when the profile is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          user: {
            name: "alice",
            isAdministrator: true,
            roles: [],
            profile: null,
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    const detail = await client.getUserDetail("alice");
    expect(detail).toEqual({
      name: "alice",
      isAdministrator: true,
      roles: [],
      lastLogin: null,
      lastActivity: null,
    });
  });
});

describe("hygiene client — deleteUser success path", () => {
  it("resolves when the API returns successful=true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteUser: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.deleteUser("alice");
    expect(lastFetchBody(fetchMock).variables).toMatchObject({ input: { userName: "alice" } });
  });
});

describe("hygiene client — search query-option permutations", () => {
  it("threads language, latestVersionOnly, sort, and filterStatement into the document", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { search: { totalCount: 0, results: [] } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHygieneApiClient({ environment: baseEnv });
    await client.search({
      language: "en",
      latestVersionOnly: true,
      sort: { name: "_name", direction: "ASC" } as never,
      filterStatement: { criteria: { field: "_path", value: "abc", criteriaType: "EXACT" } },
    });

    const query = lastFetchBody(fetchMock).query;
    expect(query).toContain('language: "en"');
    expect(query).toContain("latestVersionOnly: true");
    expect(query).toContain("direction: ASC");
    expect(query).toContain("filterStatement:");
  });
});
