import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflowInspect } from "../../../../src/workflow/tasks/inspect";
import * as sharedModule from "../../../../src/workflow/tasks/shared";
import type { WorkflowApiClient } from "../../../../src/workflow/api/client";

vi.mock("../../../../src/workflow/tasks/shared", async () => {
  const actual = await vi.importActual<typeof sharedModule>(
    "../../../../src/workflow/tasks/shared"
  );
  return { ...actual, resolveWorkflowTenant: vi.fn() };
});

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
    environment: {} as never,
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

describe("runWorkflowInspect", () => {
  it("returns null when the item is not under workflow", async () => {
    const client = stubClient({ getItemWorkflow: vi.fn().mockResolvedValue(null) });
    installClient(client);

    const result = await runWorkflowInspect({
      item: "/sitecore/content/x",
      json: true,
    });

    expect(result).toBeNull();
    expect(client.getWorkflowCommandsForItem).not.toHaveBeenCalled();
  });

  it("returns the flattened workflow record + available commands when under workflow", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "abcdef0123456789abcdef0123456789",
        path: "/sitecore/content/x",
        workflowId: "w1",
        workflowName: "Editorial",
        stateId: "s1",
        stateName: "Draft",
        stateIsFinal: false,
      }),
      getWorkflowCommandsForItem: vi.fn().mockResolvedValue([
        { commandId: "c1", displayName: "Submit" },
        { commandId: "c2", displayName: "Reject" },
      ]),
    });
    installClient(client);

    const result = await runWorkflowInspect({
      item: "/sitecore/content/x",
      json: true,
    });

    expect(result).toEqual({
      kind: "item",
      item: {
        itemId: "abcdef0123456789abcdef0123456789",
        path: "/sitecore/content/x",
        workflow: { workflowId: "w1", workflowName: "Editorial" },
        state: { stateId: "s1", stateName: "Draft", final: false },
        availableCommands: [
          { commandId: "c1", displayName: "Submit" },
          { commandId: "c2", displayName: "Reject" },
        ],
      },
    });
    expect(client.getWorkflowCommandsForItem).toHaveBeenCalledWith({
      workflowId: "w1",
      itemId: "abcdef01-2345-6789-abcd-ef0123456789",
    });
  });

  it("routes a Workflow-templated ref to the definition view", async () => {
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue({
        itemId: "wf1",
        name: "BlogArticleApproval",
        displayName: "Blog Article Approval",
        path: "/sitecore/system/Workflows/Editorial/BlogArticleApproval",
        states: [
          {
            itemId: "s1",
            name: "Draft",
            displayName: "Draft",
            path: "/sitecore/system/Workflows/Editorial/BlogArticleApproval/Draft",
            templateName: "State",
            commands: [],
            actions: [],
          },
        ],
      }),
    });
    installClient(client);

    const result = await runWorkflowInspect({
      item: "/sitecore/system/Workflows/Editorial/BlogArticleApproval",
      json: true,
    });

    expect(result).toMatchObject({ kind: "definition" });
    expect(client.getWorkflowDefinitionDetail).toHaveBeenCalledWith({
      path: "/sitecore/system/Workflows/Editorial/BlogArticleApproval",
    });
    // Item-state path should NOT be queried when the definition view resolves.
    expect(client.getItemWorkflow).not.toHaveBeenCalled();
  });

  it("resolves a workflow by display name via findWorkflowDefinitionByName", async () => {
    const summary = {
      itemId: "wf1",
      name: "BlogArticleApproval",
      displayName: "Blog Article Approval",
      path: "/sitecore/system/Workflows/Editorial/BlogArticleApproval",
    };
    const detail = {
      ...summary,
      states: [],
    };
    const client = stubClient({
      findWorkflowDefinitionByName: vi.fn().mockResolvedValue({
        summary,
        duplicateMatches: 1,
      }),
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(detail),
    });
    installClient(client);

    const result = await runWorkflowInspect({
      item: "Blog Article Approval",
      json: true,
    });

    expect(client.findWorkflowDefinitionByName).toHaveBeenCalledWith("Blog Article Approval");
    expect(client.getWorkflowDefinitionDetail).toHaveBeenCalledWith({ itemId: "wf1" });
    expect(result).toMatchObject({ kind: "definition" });
  });

  it("returns null when a name lookup matches no workflow", async () => {
    const client = stubClient({
      findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null),
    });
    installClient(client);

    const result = await runWorkflowInspect({
      item: "made-up-workflow",
      json: true,
    });

    expect(result).toBeNull();
    expect(client.getItemWorkflow).not.toHaveBeenCalled();
  });

  it("passes a {path} selector to the client for path arguments", async () => {
    const client = stubClient({ getItemWorkflow: vi.fn().mockResolvedValue(null) });
    installClient(client);

    await runWorkflowInspect({
      item: "/sitecore/content/x",
      json: true,
    });

    expect(client.getItemWorkflow).toHaveBeenCalledWith({ path: "/sitecore/content/x" });
  });
});
