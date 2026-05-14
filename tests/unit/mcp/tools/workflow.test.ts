import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const taskMocks = vi.hoisted(() => ({
  runWorkflowInspect: vi.fn().mockResolvedValue({
    kind: "item",
    item: {
      itemId: "x",
      path: "/sitecore/content/x",
      workflow: { workflowId: "w1", workflowName: "Editorial" },
      state: { stateId: "s1", stateName: "Draft", final: false },
      availableCommands: [{ commandId: "c1", displayName: "Submit" }],
    },
  }),
  runWorkflowListCommands: vi.fn().mockResolvedValue({
    itemId: "x",
    path: "/sitecore/content/x",
    workflowId: "w1",
    commands: [{ commandId: "c1", displayName: "Submit" }],
  }),
  runWorkflowListDefs: vi.fn().mockResolvedValue({
    rootPath: "/sitecore/system/Workflows",
    workflows: [{ itemId: "wf1", name: "Sample", displayName: "Sample", path: "..." }],
  }),
  runWorkflowStatus: vi.fn().mockResolvedValue({
    siteId: "site-1",
    statistics: { workflows: [{ name: "Sample" }] },
  }),
  runWorkflowAssigned: vi.fn().mockResolvedValue({
    stateId: "s1",
    items: [{ itemId: "a", path: "/sitecore/content/a", templateName: null, updatedDate: null }],
  }),
  runWorkflowAdvance: vi.fn().mockResolvedValue({
    itemId: "x",
    path: "/sitecore/content/x",
    workflowName: "Editorial",
    fromState: "Draft",
    toState: "in-review",
    commandRequested: "Submit",
    commandUsed: "Submit",
    status: "advanced",
  }),
}));

vi.mock("../../../../src/workflow/tasks", () => ({ ...taskMocks }));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "tok",
};

const fakeExtra = {
  signal: new AbortController().signal,
  progressToken: undefined,
  sendProgress: async () => undefined,
  sendNotification: async () => undefined,
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

describe("workflow_inspect tool", () => {
  it("registers with read auth + readOnlyHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("workflow_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("routes verb='inspect' to runWorkflowInspect", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "inspect", item: "/x" }, fakeContext, fakeExtra);
    expect(taskMocks.runWorkflowInspect).toHaveBeenCalledWith(
      expect.objectContaining({ item: "/x" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "inspect" });
  });

  it("requires `item` for verb='inspect'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("workflow_inspect")!.handler({ verb: "inspect" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("routes verb='list-defs' to runWorkflowListDefs with optional root", async () => {
    const reg = await setup();
    await reg.getTool("workflow_inspect")!.handler(
      { verb: "list-defs", root: "/sitecore/system/Workflows/Editorial" },
      fakeContext,
      fakeExtra
    );
    expect(taskMocks.runWorkflowListDefs).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/sitecore/system/Workflows/Editorial" })
    );
  });

  it("requires `site` for verb='status'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("workflow_inspect")!.handler({ verb: "status" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("routes verb='assigned' with --field override", async () => {
    const reg = await setup();
    await reg.getTool("workflow_inspect")!.handler(
      { verb: "assigned", state: "s1", field: "__workflow_state", limit: 50 },
      fakeContext,
      fakeExtra
    );
    expect(taskMocks.runWorkflowAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ state: "s1", field: "__workflow_state", limit: 50 })
    );
  });
});

describe("workflow_lifecycle tool", () => {
  it("registers with write auth", async () => {
    const reg = await setup();
    const tool = reg.getTool("workflow_lifecycle")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.readOnlyHint).toBe(false);
  });

  it("routes verb='advance' to runWorkflowAdvance, threading through allowWrite", async () => {
    const reg = await setup();
    const result = await reg.getTool("workflow_lifecycle")!.handler(
      {
        verb: "advance",
        item: "/sitecore/content/x",
        command: "Submit",
        comments: "auto",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(taskMocks.runWorkflowAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        item: "/sitecore/content/x",
        command: "Submit",
        comments: "auto",
        allowWrite: true,
      })
    );
    expect(result.structuredContent).toMatchObject({ verb: "advance" });
  });
});
