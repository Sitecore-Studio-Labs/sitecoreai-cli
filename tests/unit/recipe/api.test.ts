import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config";
import { CliError } from "../../../src/shared/errors";
import { runAuthoringGraphQL } from "../../../src/recipe/api/graphql";
import { createAuthoringClient } from "../../../src/recipe/api/authoring-client";
import { SITECORE_TEMPLATES } from "../../../src/recipe/ir/sitecore-templates";

vi.mock("../../../src/recipe/api/auth", () => ({
  getAccessToken: vi.fn(),
}));

import { getAccessToken } from "../../../src/recipe/api/auth";
const getAccessTokenMock = vi.mocked(getAccessToken);

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

beforeEach(() => {
  vi.restoreAllMocks();
  getAccessTokenMock.mockResolvedValue("test-token");
  delete process.env.SITECOREAI_AUTHORING_PATH;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAuthoringGraphQL — request shape", () => {
  it("posts to <host>/sitecore/api/authoring/graphql/v1 with Bearer auth and JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await runAuthoringGraphQL<{ ok: boolean }>(baseEnv, "query Q { ok }", { x: 1 });

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method?: string; headers?: Record<string, string>; body?: string },
    ];
    expect(url).toBe("https://test.sitecorecloud.io/sitecore/api/authoring/graphql/v1");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      query: "query Q { ok }",
      variables: { x: 1 },
    });
  });

  it("respects SITECOREAI_AUTHORING_PATH override", async () => {
    process.env.SITECOREAI_AUTHORING_PATH = "/custom/authoring/path";
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await runAuthoringGraphQL(baseEnv, "query {}");

    expect(fetchMock.mock.calls[0][0]).toBe("https://test.sitecorecloud.io/custom/authoring/path");
  });

  it("preserves an https:// scheme that's already on the host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await runAuthoringGraphQL({ ...baseEnv, host: "https://test.sitecorecloud.io/" }, "query {}");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://test.sitecorecloud.io/sitecore/api/authoring/graphql/v1"
    );
  });
});

describe("runAuthoringGraphQL — error mapping", () => {
  it("throws AUTH_REQUIRED when getAccessToken returns no token", async () => {
    getAccessTokenMock.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runAuthoringGraphQL(baseEnv, "query {}")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when host is unset", async () => {
    await expect(
      runAuthoringGraphQL({ ...baseEnv, host: undefined } as EnvironmentConfiguration, "query {}")
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws NETWORK when the response is non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await runAuthoringGraphQL(baseEnv, "query {}").catch((e) => e);
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe("NETWORK");
    expect(error.message).toContain("401");
  });

  it("throws NETWORK when the response carries GraphQL errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ errors: [{ message: "no such field 'foo'" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await runAuthoringGraphQL(baseEnv, "query {}").catch((e) => e);
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe("NETWORK");
    expect(error.message).toContain("no such field 'foo'");
  });

  it("throws NETWORK with `timed out` hint on AbortError", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await runAuthoringGraphQL(baseEnv, "query {}", undefined, {
      timeoutMs: 1,
    }).catch((e) => e);
    expect(error.code).toBe("NETWORK");
    expect(error.message).toContain("timed out");
  });
});

describe("createAuthoringClient — getItem", () => {
  it("returns null when the item field is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    await expect(
      client.getItem({ itemId: "00000000-0000-0000-0000-000000000001" })
    ).resolves.toBeNull();
  });

  it("maps a remote item's fields by templateField.templateFieldId (Sitecore returns dashless GUIDs)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "11111111-1111-1111-1111-111111111111",
            name: "CtaButton",
            path: "/sitecore/templates/CtaButton",
            parent: { itemId: "00000000-0000-0000-0000-000000000aaa" },
            template: { templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db" },
            fields: {
              nodes: [
                {
                  name: "__Icon",
                  value: "Office/32x32/document.png",
                  // Sitecore returns the templateFieldId without dashes —
                  // the client must canonicalize back to 8-4-4-4-12.
                  templateField: { templateFieldId: "06d5295ced2f4a549bf226228d113318" },
                },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    const remote = await client.getItem({ itemId: "11111111-1111-1111-1111-111111111111" });
    expect(remote).toEqual({
      itemId: "11111111-1111-1111-1111-111111111111",
      name: "CtaButton",
      path: "/sitecore/templates/CtaButton",
      parentId: "00000000-0000-0000-0000-000000000aaa",
      templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      fields: [
        {
          fieldId: "06d5295c-ed2f-4a54-9bf2-26228d113318",
          name: "__Icon",
          value: "Office/32x32/document.png",
        },
      ],
    });
  });

  it("drops fields whose templateField is null (not bound to a template field — extension data)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "11111111-1111-1111-1111-111111111111",
            name: "CtaButton",
            path: "/sitecore/templates/CtaButton",
            parent: { itemId: "00000000-0000-0000-0000-000000000aaa" },
            template: { templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db" },
            fields: {
              nodes: [
                { name: "OrphanField", value: "v", templateField: null },
                {
                  name: "__Icon",
                  value: "icon",
                  templateField: { templateFieldId: "06d5295ced2f4a549bf226228d113318" },
                },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    const remote = await client.getItem({ itemId: "11111111-1111-1111-1111-111111111111" });
    expect(remote?.fields).toEqual([
      { fieldId: "06d5295c-ed2f-4a54-9bf2-26228d113318", name: "__Icon", value: "icon" },
    ]);
  });
});

describe("createAuthoringClient — mutations", () => {
  it("createItem sends the recipe-derived input to createItem mutation and returns the assigned itemId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { createItem: { item: { itemId: "11111111-1111-1111-1111-111111111111" } } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    // Pass parent as a Sitecore itemId — bypasses scai's path→itemId
    // auto-resolution, which is exercised separately below.
    const result = await client.createItem({
      templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      parent: "0de95ae4-41ab-4d01-9eb0-67441b7c2450",
      name: "CtaButton",
      fields: [
        {
          fieldId: "06d5295c-ed2f-4a54-9bf2-26228d113318",
          value: { kind: "string", value: "Office/32x32/document.png" },
        },
      ],
    });

    expect(result).toEqual({ itemId: "11111111-1111-1111-1111-111111111111" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toContain("createItem");
    // Authoring API server-assigns itemId; input must NOT carry one.
    expect(body.variables.input).not.toHaveProperty("itemId");
    expect(body.variables.input).toMatchObject({
      templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      parent: "0de95ae4-41ab-4d01-9eb0-67441b7c2450",
      name: "CtaButton",
      database: "master",
      language: "en",
      fields: [
        { name: "06d5295c-ed2f-4a54-9bf2-26228d113318", value: "Office/32x32/document.png" },
      ],
    });
  });

  it("createItem throws when the response is missing an itemId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { createItem: { item: null } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    await expect(
      client.createItem({
        templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
        parent: "0de95ae4-41ab-4d01-9eb0-67441b7c2450",
        name: "CtaButton",
        fields: [],
      })
    ).rejects.toThrow(/no itemId/);
  });

  it("createItem with a path parent resolves to itemId via getItem and sends the GUID to the mutation", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes("query") && body.variables?.path) {
        // getItem({ path }) — return an existing item with an itemId.
        return okResponse({
          data: {
            item: {
              itemId: "0de95ae441ab4d019eb067441b7c2450",
              name: "templates",
              path: body.variables.path,
              parent: { itemId: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
              template: { templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER },
              fields: { nodes: [] },
            },
          },
        });
      }
      return okResponse({
        data: { createItem: { item: { itemId: "22222222-2222-2222-2222-222222222222" } } },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    const result = await client.createItem({
      templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      parent: "/sitecore/templates",
      name: "CtaButton",
      fields: [],
    });

    expect(result).toEqual({ itemId: "22222222-2222-2222-2222-222222222222" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    // Parent must be the resolved itemId, not the raw path — the
    // Authoring schema's `CreateItemInput.parent` is `ID!`, not String.
    // Sitecore returns itemIds with dashes stripped; scai forwards
    // whatever the API returned without re-dashifying.
    expect(createBody.variables.input.parent).toBe("0de95ae441ab4d019eb067441b7c2450");
  });

  it("createItem with a path parent that doesn't exist auto-provisions the missing folder chain", async () => {
    // Track per-path state so the test can simulate "doesn't exist yet"
    // for the missing leaf segment that scai must auto-create.
    const existing: Record<string, string> = {
      "/sitecore/templates/Project/sync": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes("query") && body.variables?.path) {
        const found = existing[body.variables.path];
        if (!found) return okResponse({ data: { item: null } });
        return okResponse({
          data: {
            item: {
              itemId: found,
              name: body.variables.path.split("/").pop()!,
              path: body.variables.path,
              parent: { itemId: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
              template: { templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER },
              fields: { nodes: [] },
            },
          },
        });
      }
      // createItem — assign a deterministic id based on call order.
      const callIndex = fetchMock.mock.calls.length;
      const newItemId = `bbbbbbbb-bbbb-bbbb-bbbb-${String(callIndex).padStart(12, "0")}`;
      const inputPath =
        body.variables?.input?.name === "Components"
          ? "/sitecore/templates/Project/sync/Components"
          : undefined;
      if (inputPath) existing[inputPath] = newItemId;
      return okResponse({ data: { createItem: { item: { itemId: newItemId } } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    const result = await client.createItem({
      templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      parent: "/sitecore/templates/Project/sync/Components",
      name: "CtaButton",
      fields: [],
    });

    // Two creates: the auto-created `Components` folder, then the
    // recipe-driven `CtaButton` template.
    const createCalls = fetchMock.mock.calls.filter((call) => {
      const body = JSON.parse(call[1].body);
      return body.query.includes("createItem");
    });
    expect(createCalls).toHaveLength(2);

    // Auto-created folder uses TEMPLATE_FOLDER under /sitecore/templates/.
    const folderInput = JSON.parse(createCalls[0][1].body).variables.input;
    expect(folderInput).toMatchObject({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parent: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });

    // The actual CtaButton create receives the auto-created folder's itemId.
    const itemInput = JSON.parse(createCalls[1][1].body).variables.input;
    expect(itemInput.name).toBe("CtaButton");
    expect(itemInput.parent).toBe(existing["/sitecore/templates/Project/sync/Components"]);
    // result.itemId is the leaf (CtaButton) itemId, distinct from the
    // auto-created Components folder.
    expect(result.itemId).not.toBe(existing["/sitecore/templates/Project/sync/Components"]);
    expect(result.itemId).toMatch(/^bbbbbbbb-bbbb-bbbb-bbbb-/);
  });

  it("updateItem sends only itemId + fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { updateItem: { item: { itemId: "11111111-1111-1111-1111-111111111111" } } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    await client.updateItem({
      itemId: "11111111-1111-1111-1111-111111111111",
      fields: [
        {
          fieldId: "06d5295c-ed2f-4a54-9bf2-26228d113318",
          value: { kind: "string", value: "Office/32x32/document.png" },
        },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toContain("updateItem");
    expect(body.variables.input).toEqual({
      itemId: "11111111-1111-1111-1111-111111111111",
      fields: [
        { name: "06d5295c-ed2f-4a54-9bf2-26228d113318", value: "Office/32x32/document.png" },
      ],
    });
  });

  it("updateItem prefers fieldName over fieldId in the mutation input when both are present", async () => {
    // Recipe-created fields carry a uuidv5 fieldId for IR refKey purposes
    // and a human-readable fieldName for the mutation. The tenant's actual
    // field GUID is server-assigned, so the recipe-derived GUID would never
    // resolve — name is the only reliable selector.
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { updateItem: { item: { itemId: "22222222-2222-2222-2222-222222222222" } } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    await client.updateItem({
      itemId: "22222222-2222-2222-2222-222222222222",
      fields: [
        {
          fieldId: "c8a15ad2-8107-5cdd-a248-8c94eff1488e",
          fieldName: "Body",
          value: { kind: "string", value: "Hello" },
        },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables.input.fields).toEqual([{ name: "Body", value: "Hello" }]);
  });

  it("deleteItem sends the itemId + permanently=true and selects { successful }", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: true } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    await client.deleteItem({ itemId: "11111111-1111-1111-1111-111111111111" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The mutation needs a subselection on DeleteItemPayload — the bare
    // `deleteItem(input)` form fails Sitecore's leaf-selection check.
    expect(body.query).toContain("successful");
    expect(body.variables).toEqual({
      input: {
        itemId: "11111111-1111-1111-1111-111111111111",
        // Permanently bypasses the recycle bin so deleted items don't keep
        // occupying their original path under Recycle Bin.
        permanently: true,
      },
    });
  });

  it("deleteItem throws when the mutation reports successful: false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { deleteItem: { successful: false } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    await expect(
      client.deleteItem({ itemId: "11111111-1111-1111-1111-111111111111" })
    ).rejects.toThrow(/successful: false/);
  });
});

describe("createAuthoringClient — getChildren", () => {
  it("returns [] when the parent does not exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    await expect(
      client.getChildren({ itemId: "00000000-0000-0000-0000-000000000000" })
    ).resolves.toEqual([]);
  });

  it("maps each child node to a RemoteItem", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            children: {
              nodes: [
                {
                  itemId: "11111111-1111-1111-1111-111111111111",
                  name: "child-1",
                  path: "/sitecore/templates/parent/child-1",
                  parent: { itemId: "00000000-0000-0000-0000-000000000000" },
                  template: { templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db" },
                  fields: {
                    nodes: [
                      {
                        name: "Title",
                        value: "v1",
                        templateField: {
                          templateFieldId: "06d5295ced2f4a549bf226228d113318",
                        },
                      },
                    ],
                  },
                },
                {
                  itemId: "22222222-2222-2222-2222-222222222222",
                  name: "child-2",
                  path: "/sitecore/templates/parent/child-2",
                  parent: { itemId: "00000000-0000-0000-0000-000000000000" },
                  template: { templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db" },
                  fields: { nodes: [] },
                },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAuthoringClient({ environment: baseEnv });
    const children = await client.getChildren({
      itemId: "00000000-0000-0000-0000-000000000000",
    });
    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({
      name: "child-1",
      path: "/sitecore/templates/parent/child-1",
      fields: [{ fieldId: "06d5295c-ed2f-4a54-9bf2-26228d113318", name: "Title", value: "v1" }],
    });
    expect(children[1]).toMatchObject({ name: "child-2", fields: [] });
  });
});
