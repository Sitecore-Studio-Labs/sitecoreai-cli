import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflowCommands } from "../../../../src/workflow/tasks/commands";
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

describe("runWorkflowCommands", () => {
  it("returns null when the item is not under workflow", async () => {
    const client = stubClient({ getItemWorkflow: vi.fn().mockResolvedValue(null) });
    installClient(client);

    const result = await runWorkflowCommands({
      item: "/sitecore/content/x",
      json: true,
    });

    expect(result).toBeNull();
    expect(client.getWorkflowCommandsForItem).not.toHaveBeenCalled();
  });

  it("returns the available commands for the item's current state", async () => {
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
      getWorkflowCommandsForItem: vi
        .fn()
        .mockResolvedValue([{ commandId: "c1", displayName: "Submit" }]),
    });
    installClient(client);

    const result = await runWorkflowCommands({
      item: "/sitecore/content/x",
      json: true,
    });

    expect(result).toEqual({
      itemId: "abcdef0123456789abcdef0123456789",
      path: "/sitecore/content/x",
      workflowId: "w1",
      commands: [{ commandId: "c1", displayName: "Submit" }],
    });
  });
});
