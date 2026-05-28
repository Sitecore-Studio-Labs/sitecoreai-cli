import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const authMocks = vi.hoisted(() => ({
  resolveToolBinding: vi.fn(),
}));

vi.mock("../../../../src/mcp/auth", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/mcp/auth")>(
    "../../../../src/mcp/auth"
  );
  return { ...actual, resolveToolBinding: authMocks.resolveToolBinding };
});

const taskMocks = vi.hoisted(() => ({
  runWorkflowGet: vi.fn().mockResolvedValue({
    kind: "item",
    item: {
      itemId: "x",
      path: "/sitecore/content/x",
      workflow: { workflowId: "w1", workflowName: "Editorial" },
      state: { stateId: "s1", stateName: "Draft", final: false },
      availableCommands: [{ commandId: "c1", displayName: "Submit" }],
    },
  }),
  runWorkflowCommands: vi.fn().mockResolvedValue({
    itemId: "x",
    path: "/sitecore/content/x",
    workflowId: "w1",
    commands: [{ commandId: "c1", displayName: "Submit" }],
  }),
  runWorkflowDefinitions: vi.fn().mockResolvedValue({
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
  runWorkflowReset: vi.fn().mockResolvedValue({
    itemId: "x",
    path: "/sitecore/content/x",
    status: "reset",
    message: "Reset /sitecore/content/x to initial state.",
  }),
  runWorkflowApply: vi.fn().mockResolvedValue({
    itemId: "x",
    path: "/sitecore/content/x",
    status: "applied",
    message: "Attached Article Workflow to /sitecore/content/x.",
  }),
}));

const hygieneTaskMocks = vi.hoisted(() => ({
  runCleanupWorkflowAdvance: vi.fn().mockResolvedValue([]),
  runCleanupWorkflowApply: vi.fn().mockResolvedValue([
    {
      itemId: "x",
      path: "/sitecore/content/x/Page1",
      templateId: null,
      workflowItemId: "wf-1",
      workflowName: "Article Workflow",
      stateItemId: "s1",
      stateName: "Draft",
      status: "applied",
    },
  ]),
}));

vi.mock("../../../../src/workflow/tasks/advance", () => ({
  runWorkflowAdvance: taskMocks.runWorkflowAdvance,
}));
vi.mock("../../../../src/workflow/tasks/apply", () => ({
  runWorkflowApply: taskMocks.runWorkflowApply,
}));
vi.mock("../../../../src/workflow/tasks/assigned", () => ({
  runWorkflowAssigned: taskMocks.runWorkflowAssigned,
}));
vi.mock("../../../../src/workflow/tasks/get", () => ({
  runWorkflowGet: taskMocks.runWorkflowGet,
}));
vi.mock("../../../../src/workflow/tasks/commands", () => ({
  runWorkflowCommands: taskMocks.runWorkflowCommands,
}));
vi.mock("../../../../src/workflow/tasks/definitions", () => ({
  runWorkflowDefinitions: taskMocks.runWorkflowDefinitions,
}));
vi.mock("../../../../src/workflow/tasks/reset", () => ({
  runWorkflowReset: taskMocks.runWorkflowReset,
}));
vi.mock("../../../../src/workflow/tasks/status", () => ({
  runWorkflowStatus: taskMocks.runWorkflowStatus,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/workflow-advance", () => ({
  runCleanupWorkflowAdvance: hygieneTaskMocks.runCleanupWorkflowAdvance,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/workflow-apply", () => ({
  runCleanupWorkflowApply: hygieneTaskMocks.runCleanupWorkflowApply,
}));

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

beforeEach(() => {
  authMocks.resolveToolBinding.mockReset();
  authMocks.resolveToolBinding.mockImplementation(
    async (ctx: McpContext, environmentName?: string) => {
      if (!environmentName || environmentName === ctx.envName) {
        return ctx;
      }
      throw new Error(`unexpected retarget to '${environmentName}'`);
    }
  );
});

describe("workflow_inspect tool", () => {
  it("registers with read auth + readOnlyHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("workflow_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("routes verb='get' to runWorkflowGet", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "get", item: "/x" }, fakeContext, fakeExtra);
    expect(taskMocks.runWorkflowGet).toHaveBeenCalledWith(expect.objectContaining({ item: "/x" }));
    expect(result.structuredContent).toMatchObject({ verb: "get" });
  });

  it("requires `item` for verb='get'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("workflow_inspect")!.handler({ verb: "get" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("routes verb='definitions' to runWorkflowDefinitions with optional root", async () => {
    const reg = await setup();
    await reg
      .getTool("workflow_inspect")!
      .handler(
        { verb: "definitions", root: "/sitecore/system/Workflows/Editorial" },
        fakeContext,
        fakeExtra
      );
    expect(taskMocks.runWorkflowDefinitions).toHaveBeenCalledWith(
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
    await reg
      .getTool("workflow_inspect")!
      .handler(
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

  it("verb='bulk-apply' requires workflow", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_lifecycle")!
        .handler({ verb: "bulk-apply", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("routes verb='bulk-apply' to runCleanupWorkflowApply with workflow + template + reattach", async () => {
    const reg = await setup();
    const result = await reg.getTool("workflow_lifecycle")!.handler(
      {
        verb: "bulk-apply",
        workflow: "Article Workflow",
        template: "/sitecore/templates/Foundation/Article",
        reattach: true,
        maxApplies: 25,
        root: "/sitecore/content/MySite",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(hygieneTaskMocks.runCleanupWorkflowApply).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: "Article Workflow",
        template: "/sitecore/templates/Foundation/Article",
        reattach: true,
        maxApplies: 25,
        root: "/sitecore/content/MySite",
        allowWrite: true,
      })
    );
    expect(result.structuredContent).toMatchObject({ verb: "bulk-apply" });
    expect(result.content[0]!.text).toContain("attached");
  });

  it("verb='bulk-apply' with whatIf=true reports the plan", async () => {
    hygieneTaskMocks.runCleanupWorkflowApply.mockResolvedValueOnce([
      {
        itemId: "x",
        path: "/sitecore/content/x/Page1",
        templateId: null,
        workflowItemId: "wf-1",
        workflowName: "Article Workflow",
        stateItemId: "s1",
        stateName: "Draft",
        status: "what-if",
      },
    ]);
    const reg = await setup();
    const result = await reg.getTool("workflow_lifecycle")!.handler(
      {
        verb: "bulk-apply",
        workflow: "Article Workflow",
        whatIf: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(result.content[0]!.text).toContain("would attach");
  });
});

describe("workflow_inspect — remaining verbs + validation", () => {
  it("verb='commands' requires `item`", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_inspect")!
        .handler({ verb: "commands" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='commands' routes to runWorkflowCommands", async () => {
    taskMocks.runWorkflowCommands.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "commands", item: "/x" }, fakeContext, fakeExtra);
    expect(taskMocks.runWorkflowCommands).toHaveBeenCalledWith(
      expect.objectContaining({ item: "/x" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "commands" });
  });

  it("verb='commands' reports 'not under workflow' when the runner returns null", async () => {
    taskMocks.runWorkflowCommands.mockResolvedValueOnce(null);
    const reg = await setup();
    const result = await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "commands", item: "/x" }, fakeContext, fakeExtra);
    expect(result.content[0]!.text).toContain("not under workflow");
  });

  it("verb='status' routes to runWorkflowStatus with site + contentEnvironmentId", async () => {
    taskMocks.runWorkflowStatus.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("workflow_inspect")!
      .handler(
        { verb: "status", site: "site-1", contentEnvironmentId: "main" },
        fakeContext,
        fakeExtra
      );
    expect(taskMocks.runWorkflowStatus).toHaveBeenCalledWith(
      expect.objectContaining({ site: "site-1", contentEnvironmentId: "main" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "status" });
  });

  it("verb='assigned' requires `state`", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_inspect")!
        .handler({ verb: "assigned" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='get' renders the definition branch when runner returns kind='definition'", async () => {
    taskMocks.runWorkflowGet.mockResolvedValueOnce({
      kind: "definition",
      definition: {
        name: "Editorial",
        displayName: "Editorial Workflow",
        path: "/sitecore/system/Workflows/Editorial",
        states: [{ stateId: "s1" }, { stateId: "s2" }],
      },
    });
    const reg = await setup();
    const result = await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "get", item: "Editorial" }, fakeContext, fakeExtra);
    expect(result.content[0]!.text).toContain("Workflow definition");
    expect(result.content[0]!.text).toContain("2 state(s)");
  });

  it("verb='get' renders the 'not under workflow' branch when runner returns null", async () => {
    taskMocks.runWorkflowGet.mockResolvedValueOnce(null);
    const reg = await setup();
    const result = await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "get", item: "/x" }, fakeContext, fakeExtra);
    expect(result.content[0]!.text).toContain("is not under workflow");
  });
});

describe("workflow_lifecycle — verb routing + validation", () => {
  it("verb='advance' requires `item` and `command`", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_lifecycle")!
        .handler({ verb: "advance", item: "/x", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='advance' with whatIf renders the would-execute summary", async () => {
    taskMocks.runWorkflowAdvance.mockResolvedValueOnce({
      itemId: "x",
      path: "/sitecore/content/x",
      commandUsed: "Submit",
      status: "what-if",
    });
    const reg = await setup();
    const result = await reg
      .getTool("workflow_lifecycle")!
      .handler(
        { verb: "advance", item: "/x", command: "Submit", whatIf: true },
        fakeContext,
        fakeExtra
      );
    expect(result.content[0]!.text).toContain("Would execute");
  });

  it("verb='reset' requires `item`", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_lifecycle")!
        .handler({ verb: "reset", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='reset' routes to runWorkflowReset", async () => {
    taskMocks.runWorkflowReset.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("workflow_lifecycle")!
      .handler({ verb: "reset", item: "/x", allowWrite: true }, fakeContext, fakeExtra);
    expect(taskMocks.runWorkflowReset).toHaveBeenCalledWith(
      expect.objectContaining({ item: "/x" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "reset" });
  });

  it("verb='apply-workflow' requires `item` and `workflow`", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_lifecycle")!
        .handler(
          { verb: "apply-workflow", item: "/x", allowWrite: true } as never,
          fakeContext,
          fakeExtra
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='apply-workflow' routes to runWorkflowApply with workflow + state", async () => {
    taskMocks.runWorkflowApply.mockClear();
    const reg = await setup();
    const result = await reg.getTool("workflow_lifecycle")!.handler(
      {
        verb: "apply-workflow",
        item: "/x",
        workflow: "Article Workflow",
        state: "Draft",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(taskMocks.runWorkflowApply).toHaveBeenCalledWith(
      expect.objectContaining({ item: "/x", workflow: "Article Workflow", state: "Draft" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "apply-workflow" });
  });

  it("verb='bulk-advance' requires `commandName`", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_lifecycle")!
        .handler({ verb: "bulk-advance", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='bulk-advance' routes to runCleanupWorkflowAdvance and reports the apply summary", async () => {
    hygieneTaskMocks.runCleanupWorkflowAdvance.mockResolvedValueOnce([
      { itemId: "a", status: "advanced" },
      { itemId: "b", status: "failed" },
      { itemId: "c", status: "skipped-no-command" },
    ]);
    const reg = await setup();
    const result = await reg.getTool("workflow_lifecycle")!.handler(
      {
        verb: "bulk-advance",
        commandName: "Approve",
        root: "/sitecore/content",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(hygieneTaskMocks.runCleanupWorkflowAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: "Approve", root: "/sitecore/content" })
    );
    expect(result.content[0]!.text).toContain("advanced 1");
    expect(result.content[0]!.text).toContain("failed 1");
  });

  it("verb='bulk-advance' with whatIf=true reports the plan count", async () => {
    hygieneTaskMocks.runCleanupWorkflowAdvance.mockResolvedValueOnce([
      { itemId: "a", status: "what-if" },
      { itemId: "b", status: "what-if" },
    ]);
    const reg = await setup();
    const result = await reg
      .getTool("workflow_lifecycle")!
      .handler(
        { verb: "bulk-advance", commandName: "Approve", whatIf: true },
        fakeContext,
        fakeExtra
      );
    expect(result.content[0]!.text).toContain("2 item(s) would advance");
  });
});

describe("workflow_lifecycle — denyMcpElevation gate", () => {
  // The bound context's resolved.root carries an env flagged
  // denyMcpElevation; resolveToolBinding (mocked) echoes that context,
  // so `ensureMcpElevationAllowed` fires before the task runner.
  const denyContext: McpContext = {
    envName: "prod",
    configPath: "/tmp",
    resolved: {
      envName: "prod",
      environment: {} as never,
      root: {
        environments: { prod: { name: "prod", denyMcpElevation: true } },
      } as never,
      timeoutMs: undefined,
    },
    allowWriteEnabled: false,
    deployToken: "tok",
  };

  it("rejects an advance when the target env denies MCP elevation", async () => {
    taskMocks.runWorkflowAdvance.mockClear();
    const reg = await setup();
    await expect(
      reg
        .getTool("workflow_lifecycle")!
        .handler(
          { verb: "advance", item: "/x", command: "Submit", allowWrite: true },
          denyContext,
          fakeExtra
        )
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(taskMocks.runWorkflowAdvance).not.toHaveBeenCalled();
  });
});

describe("workflow tools — per-call environment retargeting", () => {
  it("workflow_inspect uses the bound env when environmentName is omitted", async () => {
    const reg = await setup();
    await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "get", item: "/x" }, fakeContext, fakeExtra);
    expect(taskMocks.runWorkflowGet).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "test-env" })
    );
  });

  it("workflow_inspect threads environmentName into the task runner when set", async () => {
    taskMocks.runWorkflowGet.mockClear();
    const reg = await setup();
    await reg
      .getTool("workflow_inspect")!
      .handler({ verb: "get", item: "/x", environmentName: "prod" }, fakeContext, fakeExtra);
    expect(taskMocks.runWorkflowGet).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "prod" })
    );
  });

  it("workflow_lifecycle checks denyMcpElevation against the retargeted env", async () => {
    authMocks.resolveToolBinding.mockResolvedValue({
      envName: "prod",
      resolved: {
        envName: "prod",
        environment: {},
        root: { environments: {} },
        timeoutMs: undefined,
      },
      allowWriteEnabled: true,
      deployToken: "prod-token",
    });
    taskMocks.runWorkflowAdvance.mockClear();
    const reg = await setup();
    await reg.getTool("workflow_lifecycle")!.handler(
      {
        verb: "advance",
        item: "/sitecore/content/x",
        command: "Submit",
        environmentName: "prod",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(authMocks.resolveToolBinding).toHaveBeenCalledWith(fakeContext, "prod");
    expect(taskMocks.runWorkflowAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "prod" })
    );
  });
});
