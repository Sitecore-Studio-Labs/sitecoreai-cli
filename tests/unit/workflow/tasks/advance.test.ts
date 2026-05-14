import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflowAdvance } from "../../../../src/workflow/tasks/advance";
import * as sharedModule from "../../../../src/workflow/tasks/shared";
import * as allowWriteModule from "../../../../src/shared/allow-write";
import type { WorkflowApiClient } from "../../../../src/workflow/api/client";

vi.mock("../../../../src/workflow/tasks/shared", async () => {
  const actual = await vi.importActual<typeof sharedModule>(
    "../../../../src/workflow/tasks/shared"
  );
  return { ...actual, resolveWorkflowTenant: vi.fn() };
});

vi.mock("../../../../src/shared/allow-write", async () => {
  const actual = await vi.importActual<typeof allowWriteModule>(
    "../../../../src/shared/allow-write"
  );
  return { ...actual, ensureAllowWrite: vi.fn() };
});

const stubClient = (overrides: Partial<WorkflowApiClient> = {}): WorkflowApiClient => ({
  getItemWorkflow: vi.fn(),
  getWorkflowCommandsForItem: vi.fn().mockResolvedValue([]),
  executeWorkflowCommand: vi.fn(),
  listWorkflowDefinitions: vi.fn().mockResolvedValue([]),
  searchItemsByWorkflowState: vi.fn().mockResolvedValue([]),
  ...overrides,
});

const installClient = (client: WorkflowApiClient): void => {
  vi.mocked(sharedModule.resolveWorkflowTenant).mockReturnValue({
    envName: "test",
    environment: {} as never,
    root: { environments: {} } as never,
    client,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWorkflowAdvance", () => {
  it("throws INPUT_INVALID when --command is missing", async () => {
    installClient(stubClient());
    await expect(
      runWorkflowAdvance({ item: "/x", command: "", json: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("calls ensureAllowWrite when not in --what-if mode", async () => {
    const client = stubClient({ getItemWorkflow: vi.fn().mockResolvedValue(null) });
    installClient(client);

    await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "Submit",
      allowWrite: true,
      json: true,
    });

    expect(allowWriteModule.ensureAllowWrite).toHaveBeenCalledWith(
      expect.objectContaining({ environments: expect.anything() }),
      "test",
      true
    );
  });

  it("skips the allowWrite gate in --what-if mode", async () => {
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
      ]),
    });
    installClient(client);

    const result = await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "Submit",
      whatIf: true,
      json: true,
    });

    expect(result.status).toBe("what-if");
    expect(result.commandUsed).toBe("Submit");
    expect(allowWriteModule.ensureAllowWrite).not.toHaveBeenCalled();
    expect(client.executeWorkflowCommand).not.toHaveBeenCalled();
  });

  it("returns skipped-no-workflow when the item is not under workflow", async () => {
    const client = stubClient({ getItemWorkflow: vi.fn().mockResolvedValue(null) });
    installClient(client);

    const result = await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "Submit",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-no-workflow");
    expect(client.executeWorkflowCommand).not.toHaveBeenCalled();
  });

  it("returns skipped-final when the item is in a final state", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "x",
        path: "/sitecore/content/x",
        workflowId: "w1",
        workflowName: "Editorial",
        stateId: "approved",
        stateName: "Approved",
        stateIsFinal: true,
      }),
    });
    installClient(client);

    const result = await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "Approve",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-final");
    expect(client.getWorkflowCommandsForItem).not.toHaveBeenCalled();
  });

  it("returns skipped-no-command when the named command is unavailable", async () => {
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
      ]),
    });
    installClient(client);

    const result = await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "Reject",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-no-command");
    expect(client.executeWorkflowCommand).not.toHaveBeenCalled();
  });

  it("executes the command and returns the next state on success", async () => {
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
      ]),
      executeWorkflowCommand: vi.fn().mockResolvedValue({
        successful: true,
        nextStateId: "s2",
        message: null,
      }),
    });
    installClient(client);

    const result = await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "submit", // case-insensitive
      comments: "auto-approve",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("advanced");
    expect(result.toState).toBe("s2");
    expect(result.commandUsed).toBe("Submit");
    expect(client.executeWorkflowCommand).toHaveBeenCalledWith({
      commandId: "c1",
      itemId: "abcdef01-2345-6789-abcd-ef0123456789",
      comments: "auto-approve",
    });
  });

  it("returns failed when the API responds successful=false", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "x",
        path: "/sitecore/content/x",
        workflowId: "w1",
        workflowName: "Editorial",
        stateId: "s1",
        stateName: "Draft",
        stateIsFinal: false,
      }),
      getWorkflowCommandsForItem: vi.fn().mockResolvedValue([
        { commandId: "c1", displayName: "Submit" },
      ]),
      executeWorkflowCommand: vi.fn().mockResolvedValue({
        successful: false,
        nextStateId: null,
        message: "Command not valid in current state.",
      }),
    });
    installClient(client);

    const result = await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "Submit",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toBe("Command not valid in current state.");
  });

  it("returns failed when executeWorkflowCommand throws", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "x",
        path: "/sitecore/content/x",
        workflowId: "w1",
        workflowName: "Editorial",
        stateId: "s1",
        stateName: "Draft",
        stateIsFinal: false,
      }),
      getWorkflowCommandsForItem: vi.fn().mockResolvedValue([
        { commandId: "c1", displayName: "Submit" },
      ]),
      executeWorkflowCommand: vi.fn().mockRejectedValue(new Error("network died")),
    });
    installClient(client);

    const result = await runWorkflowAdvance({
      item: "/sitecore/content/x",
      command: "Submit",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toBe("network died");
  });
});
