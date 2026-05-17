import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflowReset } from "../../../../src/workflow/tasks/reset";
import * as sharedModule from "../../../../src/workflow/tasks/shared";
import * as allowWriteModule from "../../../../src/policy/allow-write";
import type { WorkflowApiClient } from "../../../../src/workflow/api/client";

vi.mock("../../../../src/workflow/tasks/shared", async () => {
  const actual = await vi.importActual<typeof sharedModule>(
    "../../../../src/workflow/tasks/shared"
  );
  return { ...actual, resolveWorkflowTenant: vi.fn() };
});

vi.mock("../../../../src/policy/allow-write", async () => {
  const actual = await vi.importActual<typeof allowWriteModule>(
    "../../../../src/policy/allow-write"
  );
  return { ...actual, ensureAllowWrite: vi.fn() };
});

const stubClient = (overrides: Partial<WorkflowApiClient> = {}): WorkflowApiClient => ({
  getItemWorkflow: vi.fn().mockResolvedValue(null),
  getWorkflowCommandsForItem: vi.fn().mockResolvedValue([]),
  executeWorkflowCommand: vi.fn(),
  listWorkflowDefinitions: vi.fn().mockResolvedValue([]),
  searchItemsByWorkflowState: vi.fn().mockResolvedValue([]),
  getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(null),
  findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null),
  setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
  getWorkflowInitialStateId: vi.fn().mockResolvedValue(null),
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

/** An item attached to a workflow at a non-initial state. */
const inWorkflow = (stateId: string, stateName = "Submitted") => ({
  itemId: "abcdef0123456789abcdef0123456789",
  path: "/sitecore/content/x",
  workflowId: "{w1}",
  workflowName: "Editorial",
  stateId,
  stateName,
  stateIsFinal: false,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWorkflowReset", () => {
  it("returns skipped-no-workflow when the item is not under workflow", async () => {
    const client = stubClient({ getItemWorkflow: vi.fn().mockResolvedValue(null) });
    installClient(client);

    const result = await runWorkflowReset({
      item: "/sitecore/content/x",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-no-workflow");
    expect(client.getWorkflowInitialStateId).not.toHaveBeenCalled();
    expect(client.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("throws UNKNOWN when the workflow has no __Initial state", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue(inWorkflow("{s2}")),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue(null),
    });
    installClient(client);

    await expect(
      runWorkflowReset({ item: "/sitecore/content/x", allowWrite: true, json: true })
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("returns skipped-already-initial when the item is already at the initial state", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue(inWorkflow("{11111111}", "Draft")),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111"),
    });
    installClient(client);

    const result = await runWorkflowReset({
      item: "/sitecore/content/x",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("skipped-already-initial");
    expect(client.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("skips the allowWrite gate in --what-if mode and reports what-if", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue(inWorkflow("{s2}")),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111"),
    });
    installClient(client);

    const result = await runWorkflowReset({
      item: "/sitecore/content/x",
      whatIf: true,
      json: true,
    });

    expect(result.status).toBe("what-if");
    expect(result.toStateId).toBe("11111111");
    expect(allowWriteModule.ensureAllowWrite).not.toHaveBeenCalled();
    expect(client.setItemWorkflowState).not.toHaveBeenCalled();
  });

  it("calls ensureAllowWrite when not in --what-if mode", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue(inWorkflow("{s2}")),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111"),
    });
    installClient(client);

    await runWorkflowReset({
      item: "/sitecore/content/x",
      allowWrite: true,
      json: true,
    });

    expect(allowWriteModule.ensureAllowWrite).toHaveBeenCalledWith(
      expect.objectContaining({ environments: expect.anything() }),
      "test",
      true
    );
  });

  it("resets the item to the initial state and returns reset on success", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue(inWorkflow("{s2}", "Submitted")),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111"),
      setItemWorkflowState: vi.fn().mockResolvedValue(undefined),
    });
    installClient(client);

    const result = await runWorkflowReset({
      item: "/sitecore/content/x",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("reset");
    expect(result.fromState).toBe("Submitted");
    expect(result.toStateId).toBe("11111111");
    expect(client.setItemWorkflowState).toHaveBeenCalledWith({
      itemId: "abcdef0123456789abcdef0123456789",
      stateId: "11111111",
    });
  });

  it("returns failed when setItemWorkflowState throws", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue(inWorkflow("{s2}")),
      getWorkflowInitialStateId: vi.fn().mockResolvedValue("11111111"),
      setItemWorkflowState: vi.fn().mockRejectedValue(new Error("reset failed")),
    });
    installClient(client);

    const result = await runWorkflowReset({
      item: "/sitecore/content/x",
      allowWrite: true,
      json: true,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toBe("reset failed");
    expect(result.toStateId).toBeNull();
  });
});
