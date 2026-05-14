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

describe("workflow client — listWorkflowDefinitions", () => {
  it("returns Workflow-templated children and recurses into Workflow Folders one level", async () => {
    // First call: /sitecore/system/Workflows children
    // Second call: /sitecore/system/Workflows/Folder1 children (recursed)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              itemId: "root",
              children: {
                nodes: [
                  {
                    itemId: "wf1",
                    name: "Sample Workflow",
                    displayName: "Sample Workflow",
                    path: "/sitecore/system/Workflows/Sample Workflow",
                    template: { templateId: "t1", name: "Workflow" },
                  },
                  {
                    itemId: "folder1",
                    name: "Folder1",
                    displayName: null,
                    path: "/sitecore/system/Workflows/Folder1",
                    template: { templateId: "t2", name: "Workflow Folder" },
                  },
                  {
                    itemId: "other",
                    name: "Other",
                    displayName: null,
                    path: "/sitecore/system/Workflows/Other",
                    template: { templateId: "t3", name: "Other" },
                  },
                ],
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          data: {
            item: {
              itemId: "folder1",
              children: {
                nodes: [
                  {
                    itemId: "wf2",
                    name: "Nested Workflow",
                    displayName: "Nested",
                    path: "/sitecore/system/Workflows/Folder1/Nested Workflow",
                    template: { templateId: "t1", name: "Workflow" },
                  },
                ],
              },
            },
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const defs = await client.listWorkflowDefinitions();

    expect(defs).toEqual([
      {
        itemId: "wf1",
        name: "Sample Workflow",
        displayName: "Sample Workflow",
        path: "/sitecore/system/Workflows/Sample Workflow",
      },
      {
        itemId: "wf2",
        name: "Nested Workflow",
        displayName: "Nested",
        path: "/sitecore/system/Workflows/Folder1/Nested Workflow",
      },
    ]);
    // Folder recursion happened — two fetches total.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list when the root path resolves to no item", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { item: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const defs = await client.listWorkflowDefinitions({ rootPath: "/sitecore/missing" });

    expect(defs).toEqual([]);
  });
});

describe("workflow client — searchItemsByWorkflowState", () => {
  it("inlines the search query with EXACT enum and JSON-quoted strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          search: {
            totalCount: 2,
            results: [
              {
                itemId: "a",
                path: "/sitecore/content/x",
                templateName: "Page",
                updatedDate: "2026-05-01",
              },
              {
                itemId: "b",
                path: "/sitecore/content/y",
                templateName: "Page",
                updatedDate: "2026-05-02",
              },
            ],
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const items = await client.searchItemsByWorkflowState({ stateId: "s1" });

    expect(items).toHaveLength(2);
    const body = lastFetchBody(fetchMock);
    // Enum literal must NOT be quoted; string values must be JSON-quoted.
    expect(body.query).toContain("criteriaType: EXACT");
    expect(body.query).toContain('value: "s1"');
    expect(body.query).toContain('field: "__workflow state"');
  });

  it("honors `field` override for tenants using `__workflow_state`", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ data: { search: { totalCount: 0, results: [] } } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    await client.searchItemsByWorkflowState({ stateId: "s1", field: "__workflow_state" });

    const body = lastFetchBody(fetchMock);
    expect(body.query).toContain('field: "__workflow_state"');
  });

  it("stops paging when a short page returns", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: {
          search: {
            totalCount: 1,
            results: [
              {
                itemId: "a",
                path: "/x",
                templateName: null,
                updatedDate: null,
              },
            ],
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWorkflowApiClient({ environment: baseEnv });
    const items = await client.searchItemsByWorkflowState({ stateId: "s1", pageSize: 100 });

    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
