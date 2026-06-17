import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config/types";
import { createWorkflowApiClient } from "../../../../src/workflow/api/client";

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
): { query: string; variables?: Record<string, unknown> } =>
  JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workflow client — getItemWorkflow", () => {
  it("issues the by-id query when called with {itemId}", async () => {
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

    const client = createWorkflowApiClient({ environment: baseEnv });
    const wf = await client.getItemWorkflow({ itemId: "x" });

    expect(wf).toEqual({
      itemId: "x",
      path: "/sitecore/content/x",
      workflowId: "w1",
      workflowName: "Basic",
      stateId: "s1",
      stateName: "Draft",
      stateIsFinal: false,
    });
    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("item(where: { itemId: $itemId })");
    expect(body.variables).toEqual({ itemId: "x" });
  });

  it("issues the by-path query when called with {path}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { item: { itemId: "x", path: "/sitecore/content/x", workflow: null } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    await client.getItemWorkflow({ path: "/sitecore/content/x" });

    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("item(where: { path: $path })");
    expect(body.variables).toEqual({ path: "/sitecore/content/x" });
  });

  it("returns null when item has no workflow attached", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: { item: { itemId: "x", path: "/sitecore/content/x", workflow: null } },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const wf = await client.getItemWorkflow({ itemId: "x" });
    expect(wf).toBeNull();
  });

  it("throws INPUT_INVALID when neither itemId nor path is provided", async () => {
    const client = createWorkflowApiClient({ environment: baseEnv });
    await expect(client.getItemWorkflow({})).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("workflow client — executeWorkflowCommand", () => {
  it("requires itemId or path", async () => {
    const client = createWorkflowApiClient({ environment: baseEnv });
    await expect(client.executeWorkflowCommand({ commandId: "c1" })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("emits the mutation with the assembled input payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          executeWorkflowCommand: {
            successful: true,
            nextStateId: "s2",
            message: null,
            error: null,
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const result = await client.executeWorkflowCommand({
      commandId: "c1",
      itemId: "abc",
      comments: "auto-approve",
    });

    expect(result).toEqual({ successful: true, nextStateId: "s2", message: null });
    const body = lastFetchBody(fetchMock);
    expect(body.variables).toEqual({
      input: {
        commandId: "c1",
        item: { database: "master", itemId: "abc" },
        comments: "auto-approve",
      },
    });
  });

  it("falls back to the `error` field when `message` is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          executeWorkflowCommand: {
            successful: false,
            nextStateId: null,
            message: null,
            error: "Command not valid in current state.",
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const result = await client.executeWorkflowCommand({ commandId: "c1", path: "/x" });

    expect(result).toEqual({
      successful: false,
      nextStateId: null,
      message: "Command not valid in current state.",
    });
    // Path selector lands on `path`, not `itemId`.
    expect(lastFetchBody(fetchMock).variables).toEqual({
      input: { commandId: "c1", item: { database: "master", path: "/x" } },
    });
  });
});

describe("workflow client — getWorkflowCommandsForItem", () => {
  it("returns the command nodes for the workflow + item", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          workflow: {
            commands: {
              nodes: [{ commandId: "c1", displayName: "Submit" }],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const commands = await client.getWorkflowCommandsForItem({
      workflowId: "w1",
      itemId: "i1",
    });

    expect(commands).toEqual([{ commandId: "c1", displayName: "Submit" }]);
    expect(lastFetchBody(fetchMock).variables).toEqual({ workflowId: "w1", itemId: "i1" });
  });

  it("returns an empty array when the workflow resolves to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { workflow: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const commands = await client.getWorkflowCommandsForItem({
      workflowId: "w1",
      itemId: "i1",
    });
    expect(commands).toEqual([]);
  });
});

describe("workflow client — listWorkflowDefinitions", () => {
  it("collects Workflow-templated children and recurses one level into folders", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: { body: string }) => {
      const { variables } = JSON.parse(init.body) as { variables: { path: string } };
      if (variables.path === "/sitecore/system/Workflows") {
        return Promise.resolve(
          okResponse({
            data: {
              item: {
                itemId: "root",
                children: {
                  nodes: [
                    {
                      itemId: "wf-1",
                      name: "Editorial",
                      displayName: "Editorial Workflow",
                      path: "/sitecore/system/Workflows/Editorial",
                      template: { templateId: "t1", name: "Workflow" },
                    },
                    {
                      itemId: "folder-1",
                      name: "Archive",
                      displayName: null,
                      path: "/sitecore/system/Workflows/Archive",
                      template: { templateId: "t2", name: "Workflow Folder" },
                    },
                  ],
                },
              },
            },
          })
        );
      }
      // Folder children.
      return Promise.resolve(
        okResponse({
          data: {
            item: {
              itemId: "folder-1",
              children: {
                nodes: [
                  {
                    itemId: "wf-2",
                    name: "Legacy",
                    displayName: "Legacy Workflow",
                    path: "/sitecore/system/Workflows/Archive/Legacy",
                    template: { templateId: "t1", name: "Workflow" },
                  },
                ],
              },
            },
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const defs = await client.listWorkflowDefinitions();

    expect(defs.map((d) => d.itemId)).toEqual(["wf-1", "wf-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list when the root item is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    expect(await client.listWorkflowDefinitions()).toEqual([]);
  });
});

describe("workflow client — findWorkflowDefinitionByName", () => {
  const oneWorkflow = () =>
    vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "root",
            children: {
              nodes: [
                {
                  itemId: "wf-1",
                  name: "editorial",
                  displayName: "Editorial Workflow",
                  path: "/sitecore/system/Workflows/Editorial",
                  template: { templateId: "t1", name: "Workflow" },
                },
              ],
            },
          },
        },
      })
    );

  it("matches by display name case-insensitively", async () => {
    vi.stubGlobal("fetch", oneWorkflow());
    const client = createWorkflowApiClient({ environment: baseEnv });
    const found = await client.findWorkflowDefinitionByName("editorial workflow");
    expect(found).toMatchObject({ summary: { itemId: "wf-1" }, duplicateMatches: 1 });
  });

  it("matches by item name case-insensitively", async () => {
    vi.stubGlobal("fetch", oneWorkflow());
    const client = createWorkflowApiClient({ environment: baseEnv });
    const found = await client.findWorkflowDefinitionByName("EDITORIAL");
    expect(found?.summary.itemId).toBe("wf-1");
  });

  it("returns null when no workflow name matches", async () => {
    vi.stubGlobal("fetch", oneWorkflow());
    const client = createWorkflowApiClient({ environment: baseEnv });
    expect(await client.findWorkflowDefinitionByName("Nonexistent")).toBeNull();
  });

  it("returns null for a blank name without issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createWorkflowApiClient({ environment: baseEnv });
    expect(await client.findWorkflowDefinitionByName("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("workflow client — getWorkflowDefinitionDetail", () => {
  it("throws INPUT_INVALID when neither itemId nor path is provided", async () => {
    const client = createWorkflowApiClient({ environment: baseEnv });
    await expect(client.getWorkflowDefinitionDetail({})).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("returns null when the item is not Workflow-templated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "x",
            name: "x",
            displayName: null,
            path: "/sitecore/content/x",
            template: { templateId: "t9", name: "Page" },
            children: { nodes: [] },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    expect(await client.getWorkflowDefinitionDetail({ itemId: "x" })).toBeNull();
  });

  it("maps states with commands (and nested validations) and state-level actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            itemId: "wf-1",
            name: "Editorial",
            displayName: "Editorial Workflow",
            path: "/sitecore/system/Workflows/Editorial",
            template: { templateId: "t1", name: "Workflow" },
            children: {
              nodes: [
                {
                  itemId: "state-1",
                  name: "Draft",
                  displayName: "Draft",
                  path: "/sitecore/system/Workflows/Editorial/Draft",
                  template: { templateId: "ts", name: "State" },
                  children: {
                    nodes: [
                      {
                        itemId: "cmd-1",
                        name: "Submit",
                        displayName: "Submit",
                        path: "/sitecore/system/Workflows/Editorial/Draft/Submit",
                        template: { templateId: "tc", name: "Command" },
                        children: {
                          nodes: [
                            {
                              itemId: "val-1",
                              name: "Validation",
                              displayName: "Validation",
                              path: "/x/val",
                              template: { templateId: "tv", name: "Validation Action" },
                            },
                          ],
                        },
                      },
                      {
                        itemId: "act-1",
                        name: "Webhook",
                        displayName: "Webhook Submit",
                        path: "/x/act",
                        template: { templateId: "ta", name: "Webhook Submit Action" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const detail = await client.getWorkflowDefinitionDetail({
      path: "/sitecore/system/Workflows/Editorial",
    });

    expect(detail?.states).toHaveLength(1);
    const state = detail!.states[0];
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0].validations).toHaveLength(1);
    expect(state.actions).toHaveLength(1);
    expect(state.actions[0].itemId).toBe("act-1");
  });
});

describe("workflow client — getWorkflowInitialStateId", () => {
  it("returns the __Initial state field value with braces stripped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          item: {
            fields: {
              nodes: [
                { name: "__Workflow", value: "{w1}" },
                { name: "__Initial state", value: "{11111111-1111-1111-1111-111111111111}" },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const stateId = await client.getWorkflowInitialStateId("wf-1");
    expect(stateId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("returns null when the __Initial state field is absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { item: { fields: { nodes: [] } } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    expect(await client.getWorkflowInitialStateId("wf-1")).toBeNull();
  });
});

describe("workflow client — setItemWorkflowState", () => {
  it("throws INPUT_INVALID when neither itemId nor path is provided", async () => {
    const client = createWorkflowApiClient({ environment: baseEnv });
    await expect(client.setItemWorkflowState({ stateId: "s1" })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when neither workflowId nor stateId is provided", async () => {
    const client = createWorkflowApiClient({ environment: baseEnv });
    await expect(client.setItemWorkflowState({ itemId: "x" })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("writes only __Workflow state when given just a stateId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { updateItem: { item: { itemId: "x" } } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    await client.setItemWorkflowState({ itemId: "x", stateId: "s1" });

    const body = lastFetchBody(fetchMock);
    const input = body.variables?.input as { fields: Array<{ name: string }>; itemId: string };
    expect(input.fields.map((f) => f.name)).toEqual(["__Workflow state"]);
    expect(input.itemId).toBe("x");
  });

  it("writes both fields when given workflowId + stateId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { updateItem: { item: { itemId: "x" } } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    await client.setItemWorkflowState({
      path: "/sitecore/content/x",
      workflowId: "w1",
      stateId: "s1",
    });

    const input = lastFetchBody(fetchMock).variables?.input as {
      fields: Array<{ name: string; value: string }>;
      path: string;
    };
    expect(input.fields).toEqual([
      { name: "__Workflow", value: "w1" },
      { name: "__Workflow state", value: "s1" },
    ]);
    expect(input.path).toBe("/sitecore/content/x");
  });
});

describe("workflow client — searchItemsByWorkflowState", () => {
  it("inlines the search document and collects results across pages", async () => {
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
                  { itemId: "i1", path: "/p1", templateName: "Page", updatedDate: "2026-01-01" },
                  { itemId: "i2", path: "/p2", templateName: "Page", updatedDate: "2026-01-02" },
                ],
              },
            },
          })
        );
      }
      return Promise.resolve(
        okResponse({
          data: {
            search: {
              totalCount: 3,
              results: [
                { itemId: "i3", path: "/p3", templateName: "Page", updatedDate: "2026-01-03" },
              ],
            },
          },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const items = await client.searchItemsByWorkflowState({ stateId: "state-1", pageSize: 2 });

    expect(items.map((i) => i.itemId)).toEqual(["i1", "i2", "i3"]);
    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain("criteriaType: EXACT");
    expect(body.query).toContain('value: "state-1"');
    expect(body.variables).toBeUndefined();
  });

  it("stops once maxItems is reached", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          search: {
            totalCount: 100,
            results: [
              { itemId: "i1", path: "/p1", templateName: null, updatedDate: null },
              { itemId: "i2", path: "/p2", templateName: null, updatedDate: null },
            ],
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const items = await client.searchItemsByWorkflowState({
      stateId: "state-1",
      pageSize: 2,
      maxItems: 1,
    });

    expect(items).toHaveLength(1);
  });
});
