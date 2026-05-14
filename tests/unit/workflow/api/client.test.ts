import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config";
import { createWorkflowApiClient } from "../../../../src/workflow/api/client";

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
});
