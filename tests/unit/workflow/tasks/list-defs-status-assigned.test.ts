import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflowListDefs } from "../../../../src/workflow/tasks/list-defs";
import { runWorkflowAssigned } from "../../../../src/workflow/tasks/assigned";
import { runWorkflowStatus } from "../../../../src/workflow/tasks/status";
import * as sharedModule from "../../../../src/workflow/tasks/shared";
import type { WorkflowApiClient } from "../../../../src/workflow/api/client";

vi.mock("../../../../src/workflow/tasks/shared", async () => {
  const actual = await vi.importActual<typeof sharedModule>(
    "../../../../src/workflow/tasks/shared"
  );
  return { ...actual, resolveWorkflowTenant: vi.fn() };
});

vi.mock("../../../../src/serialization/api/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

vi.mock("../../../../src/sites/api/sites", () => ({
  retrieveWorkflowStatistics: vi.fn(),
}));

import { retrieveWorkflowStatistics } from "../../../../src/sites/api/sites";
import { getAccessToken } from "../../../../src/serialization/api/auth";

const stubClient = (overrides: Partial<WorkflowApiClient> = {}): WorkflowApiClient => ({
  getItemWorkflow: vi.fn(),
  getWorkflowCommandsForItem: vi.fn().mockResolvedValue([]),
  executeWorkflowCommand: vi.fn(),
  listWorkflowDefinitions: vi.fn().mockResolvedValue([]),
  searchItemsByWorkflowState: vi.fn().mockResolvedValue([]),
  getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(null),
  findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null),
  ...overrides,
});

const installClient = (client: WorkflowApiClient): void => {
  vi.mocked(sharedModule.resolveWorkflowTenant).mockReturnValue({
    envName: "test",
    environment: { name: "test", host: "h" } as never,
    root: {} as never,
    client,
  });
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWorkflowListDefs", () => {
  it("returns the workflow list under the default root", async () => {
    const client = stubClient({
      listWorkflowDefinitions: vi.fn().mockResolvedValue([
        {
          itemId: "wf1",
          name: "Sample Workflow",
          displayName: "Sample Workflow",
          path: "/sitecore/system/Workflows/Sample Workflow",
        },
      ]),
    });
    installClient(client);

    const result = await runWorkflowListDefs({ json: true });

    expect(result.rootPath).toBe("/sitecore/system/Workflows");
    expect(result.workflows).toHaveLength(1);
    expect(client.listWorkflowDefinitions).toHaveBeenCalledWith({
      rootPath: "/sitecore/system/Workflows",
    });
  });

  it("honors --root override", async () => {
    const client = stubClient();
    installClient(client);

    await runWorkflowListDefs({ json: true, root: "/sitecore/system/Foo" });

    expect(client.listWorkflowDefinitions).toHaveBeenCalledWith({
      rootPath: "/sitecore/system/Foo",
    });
  });
});

describe("runWorkflowStatus", () => {
  it("throws INPUT_INVALID when --site is missing", async () => {
    installClient(stubClient());
    await expect(runWorkflowStatus({ site: "", json: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("passes siteId + access token through to the sites API helper", async () => {
    installClient(stubClient());
    vi.mocked(retrieveWorkflowStatistics).mockResolvedValue({
      workflows: [
        {
          name: "Sample",
          states: [{ name: "Draft", pageCount: 3 }],
        },
      ],
    });

    const result = await runWorkflowStatus({ site: "site-1", json: true });

    expect(result.siteId).toBe("site-1");
    expect(result.statistics.workflows?.[0]?.name).toBe("Sample");
    expect(retrieveWorkflowStatistics).toHaveBeenCalledWith(
      { accessToken: "test-token" },
      "site-1",
      undefined
    );
  });

  it("threads --content-environment-id through as a query param", async () => {
    installClient(stubClient());
    vi.mocked(retrieveWorkflowStatistics).mockResolvedValue({ workflows: [] });

    await runWorkflowStatus({ site: "site-1", contentEnvironmentId: "main", json: true });

    expect(retrieveWorkflowStatistics).toHaveBeenCalledWith(
      { accessToken: "test-token" },
      "site-1",
      { environmentId: "main" }
    );
  });

  it("throws AUTH_REQUIRED when getAccessToken returns undefined", async () => {
    installClient(stubClient());
    vi.mocked(getAccessToken).mockResolvedValueOnce(undefined);

    await expect(runWorkflowStatus({ site: "site-1", json: true })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

describe("runWorkflowAssigned", () => {
  it("throws INPUT_INVALID when --state is missing", async () => {
    installClient(stubClient());
    await expect(runWorkflowAssigned({ state: "", json: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("forwards the stateId and option overrides to the client", async () => {
    const client = stubClient({
      searchItemsByWorkflowState: vi
        .fn()
        .mockResolvedValue([{ itemId: "a", path: "/x", templateName: "Page", updatedDate: null }]),
    });
    installClient(client);

    const result = await runWorkflowAssigned({
      state: "s1",
      field: "__workflow_state",
      limit: 50,
      json: true,
    });

    expect(result.items).toHaveLength(1);
    expect(client.searchItemsByWorkflowState).toHaveBeenCalledWith({
      stateId: "s1",
      field: "__workflow_state",
      maxItems: 50,
    });
  });
});
