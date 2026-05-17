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

  it("passes an {itemId} selector to the definition lookup for GUID arguments", async () => {
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(null),
      getItemWorkflow: vi.fn().mockResolvedValue(null),
    });
    installClient(client);

    await runWorkflowInspect({
      item: "{ABCDEF01-2345-6789-ABCD-EF0123456789}",
      json: true,
    });

    // A GUID ref is tried first as a workflow definition, then as an item.
    expect(client.getWorkflowDefinitionDetail).toHaveBeenCalledWith({
      itemId: "{ABCDEF01-2345-6789-ABCD-EF0123456789}",
    });
    expect(client.getItemWorkflow).toHaveBeenCalledWith({
      itemId: "{ABCDEF01-2345-6789-ABCD-EF0123456789}",
    });
  });

  it("warns when a name lookup matches more than one workflow", async () => {
    const summary = {
      itemId: "wf1",
      name: "Approval",
      displayName: "Approval",
      path: "/sitecore/system/Workflows/Editorial/Approval",
    };
    const warn = vi.fn();
    const client = stubClient({
      findWorkflowDefinitionByName: vi.fn().mockResolvedValue({
        summary,
        duplicateMatches: 3,
      }),
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue({ ...summary, states: [] }),
    });
    installClient(client);
    const inspect = await import("../../../../src/workflow/tasks/inspect");
    const sharedSpy = await import("../../../../src/workflow/tasks/shared");
    vi.spyOn(sharedSpy, "toLogger").mockReturnValue({
      isJson: () => true,
      json: vi.fn(),
      info: vi.fn(),
      warn,
    } as never);

    await inspect.runWorkflowInspect({ item: "Approval", json: true });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Found 3 workflows matching"));
  });

  it("throws UNKNOWN when an item's workflow record carries no workflowId", async () => {
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "abcdef0123456789abcdef0123456789",
        path: "/sitecore/content/x",
        workflowId: null,
        workflowName: null,
        stateId: "s1",
        stateName: "Draft",
        stateIsFinal: false,
      }),
    });
    installClient(client);

    await expect(
      runWorkflowInspect({ item: "/sitecore/content/x", json: true })
    ).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(client.getWorkflowCommandsForItem).not.toHaveBeenCalled();
  });

  it("renders human definition lines for states with commands, validations, and actions", async () => {
    const info = vi.fn();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue({
        itemId: "wf1",
        name: "Editorial",
        displayName: "Editorial Workflow",
        path: "/sitecore/system/Workflows/Editorial",
        states: [
          {
            itemId: "s1",
            name: "Draft",
            displayName: "Draft",
            templateName: "State",
            commands: [
              {
                itemId: "c1",
                name: "Submit",
                displayName: "Submit",
                validations: [{ name: "Spell", displayName: "Spell Check", templateName: "Val" }],
              },
            ],
            actions: [{ name: "Notify", displayName: "Notify Editor", templateName: "Action" }],
          },
          {
            itemId: "s2",
            name: "Done",
            displayName: "Done",
            templateName: "Final State",
            commands: [],
            actions: [],
          },
        ],
      }),
    });
    installClient(client);
    const inspect = await import("../../../../src/workflow/tasks/inspect");
    const sharedSpy = await import("../../../../src/workflow/tasks/shared");
    vi.spyOn(sharedSpy, "toLogger").mockReturnValue({
      isJson: () => false,
      json: vi.fn(),
      info,
      warn: vi.fn(),
    } as never);

    const result = await inspect.runWorkflowInspect({
      item: "/sitecore/system/Workflows/Editorial",
    });

    expect(result).toMatchObject({ kind: "definition" });
    const lines = info.mock.calls.map((c) => c[0] as string);
    // Workflow header + state with command/validation/action + final-state template tag.
    expect(lines).toContain("Workflow:      Editorial Workflow (wf1)");
    expect(lines.some((l) => l.includes("Submit (c1)"))).toBe(true);
    expect(lines.some((l) => l.includes("validation: Spell Check [Val]"))).toBe(true);
    expect(lines.some((l) => l.includes("Notify Editor [Action]"))).toBe(true);
    expect(lines.some((l) => l.includes("Done [Final State]"))).toBe(true);
  });

  it("renders the '(no commands or actions)' line for an empty state", async () => {
    const info = vi.fn();
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue({
        itemId: "wf1",
        name: "Empty",
        displayName: null,
        path: "/sitecore/system/Workflows/Empty",
        states: [
          {
            itemId: "s1",
            name: "Idle",
            displayName: null,
            templateName: "State",
            commands: [],
            actions: [],
          },
        ],
      }),
    });
    installClient(client);
    const inspect = await import("../../../../src/workflow/tasks/inspect");
    const sharedSpy = await import("../../../../src/workflow/tasks/shared");
    vi.spyOn(sharedSpy, "toLogger").mockReturnValue({
      isJson: () => false,
      json: vi.fn(),
      info,
      warn: vi.fn(),
    } as never);

    await inspect.runWorkflowInspect({ item: "/sitecore/system/Workflows/Empty" });

    const lines = info.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("(no commands or actions)"))).toBe(true);
  });

  it("prints a human '(none ...)' line for an under-workflow item with no transitions", async () => {
    const info = vi.fn();
    const client = stubClient({
      getItemWorkflow: vi.fn().mockResolvedValue({
        itemId: "abcdef0123456789abcdef0123456789",
        path: "/sitecore/content/x",
        workflowId: "w1",
        workflowName: "Editorial",
        stateId: "s1",
        stateName: "Approved",
        stateIsFinal: true,
      }),
      getWorkflowCommandsForItem: vi.fn().mockResolvedValue([]),
    });
    installClient(client);
    const inspect = await import("../../../../src/workflow/tasks/inspect");
    const sharedSpy = await import("../../../../src/workflow/tasks/shared");
    vi.spyOn(sharedSpy, "toLogger").mockReturnValue({
      isJson: () => false,
      json: vi.fn(),
      info,
      warn: vi.fn(),
    } as never);

    const result = await inspect.runWorkflowInspect({ item: "/sitecore/content/x" });

    expect(result).toMatchObject({ kind: "item" });
    const lines = info.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("[final]"))).toBe(true);
    expect(lines.some((l) => l.includes("terminal state or no transitions"))).toBe(true);
  });

  it("emits a human 'no workflow' line for a path that is not under workflow (non-json)", async () => {
    const info = vi.fn();
    const client = stubClient({ getItemWorkflow: vi.fn().mockResolvedValue(null) });
    installClient(client);
    const inspect = await import("../../../../src/workflow/tasks/inspect");
    const sharedSpy = await import("../../../../src/workflow/tasks/shared");
    vi.spyOn(sharedSpy, "toLogger").mockReturnValue({
      isJson: () => false,
      json: vi.fn(),
      info,
      warn: vi.fn(),
    } as never);

    const result = await inspect.runWorkflowInspect({ item: "/sitecore/content/x" });

    expect(result).toBeNull();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("No workflow on /sitecore/content/x")
    );
  });

  it("emits a human 'no workflow definition matched' line for an unmatched name (non-json)", async () => {
    const info = vi.fn();
    const client = stubClient({
      findWorkflowDefinitionByName: vi.fn().mockResolvedValue(null),
    });
    installClient(client);
    const inspect = await import("../../../../src/workflow/tasks/inspect");
    const sharedSpy = await import("../../../../src/workflow/tasks/shared");
    vi.spyOn(sharedSpy, "toLogger").mockReturnValue({
      isJson: () => false,
      json: vi.fn(),
      info,
      warn: vi.fn(),
    } as never);

    const result = await inspect.runWorkflowInspect({ item: "ghost-workflow" });

    expect(result).toBeNull();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("No workflow definition matched 'ghost-workflow'")
    );
  });

  it("falls through to item inspection when a GUID ref has no matching definition", async () => {
    const client = stubClient({
      getWorkflowDefinitionDetail: vi.fn().mockResolvedValue(null),
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

    const result = await runWorkflowInspect({
      item: "abcdef01-2345-6789-abcd-ef0123456789",
      json: true,
    });

    expect(result).toMatchObject({ kind: "item" });
    expect(client.getWorkflowDefinitionDetail).toHaveBeenCalled();
    expect(client.getItemWorkflow).toHaveBeenCalled();
  });
});
