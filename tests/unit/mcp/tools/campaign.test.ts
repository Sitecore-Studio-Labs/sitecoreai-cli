import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";
import type { ToolExtra } from "../../../../src/mcp/registry";

/**
 * Campaign MCP tools (`campaign_inspect` / `campaign_manage`). The
 * campaign task runners are mocked — these tests verify the tool
 * dispatch layer: verb/resource routing, required-input validation
 * (INPUT_INVALID), what-if plan vs apply text, and the allowWrite gate
 * the dispatcher enforces on write tools. Library behavior is covered
 * separately under tests/unit/campaigns/.
 */
const taskMocks = vi.hoisted(() => ({
  runCampaignList: vi.fn().mockResolvedValue({ totalCount: 2, data: [{ id: "c-1" }] }),
  runCampaignShow: vi.fn().mockResolvedValue({
    id: "c-1",
    name: "Q1 push",
    status: "ACTIVE",
    deliverables: [{ id: "d-1" }],
  }),
  runCampaignUsers: vi.fn().mockResolvedValue({ totalCount: 7, data: [] }),
  runCampaignCreate: vi.fn().mockResolvedValue({ id: "c-new" }),
  runCampaignDelete: vi.fn().mockResolvedValue({ id: "c-1", deleted: true }),
  runDeliverableCreate: vi.fn().mockResolvedValue({ id: "d-new" }),
  runDeliverableDelete: vi.fn().mockResolvedValue({ id: "d-1", deleted: true }),
  runTaskList: vi.fn().mockResolvedValue({ totalCount: 3, data: [] }),
  runTaskShow: vi.fn().mockResolvedValue({ id: "t-1", name: "Draft copy", status: "NOT_STARTED" }),
  runTaskCreate: vi.fn().mockResolvedValue({ id: "t-new" }),
  runTaskUpdate: vi.fn().mockResolvedValue({ id: "t-1" }),
  runTaskDelete: vi.fn().mockResolvedValue({ id: "t-1", deleted: true }),
}));

vi.mock("../../../../src/campaigns/tasks", () => taskMocks);

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

const fakeExtra: ToolExtra = {
  signal: new AbortController().signal,
  progressToken: undefined,
  sendProgress: async () => undefined,
  sendNotification: async () => undefined,
};

const CAMPAIGN = "11111111-1111-1111-1111-111111111111";
const DELIVERABLE = "22222222-2222-2222-2222-222222222222";
const TASK = "33333333-3333-3333-3333-333333333333";

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockClear();
});

afterEach(async () => {
  const { __resetDispatchLockForTests } = await import("../../../../src/mcp/dispatch");
  __resetDispatchLockForTests();
});

describe("campaign_inspect", () => {
  it("registers with read auth + readOnlyHint", async () => {
    const reg = await setup();
    const tool = reg.getTool("campaign_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("verb='list' forwards limit and reports the total count", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("campaign_inspect")!
      .handler({ verb: "list", limit: 25 }, fakeContext);
    expect(taskMocks.runCampaignList).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
    expect(result.content[0].text).toContain("2 campaign(s)");
  });

  it("verb='show' requires campaignId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("campaign_inspect")!.handler({ verb: "show" } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='show' forwards campaignId and summarizes deliverables", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("campaign_inspect")!
      .handler({ verb: "show", campaignId: CAMPAIGN }, fakeContext);
    expect(taskMocks.runCampaignShow).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN })
    );
    expect(result.content[0].text).toContain("1 deliverable(s)");
  });

  it("verb='tasks' requires both campaignId and deliverableId", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("campaign_inspect")!
        .handler({ verb: "tasks", campaignId: CAMPAIGN } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='task' requires campaignId + deliverableId + taskId", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("campaign_inspect")!
        .handler(
          { verb: "task", campaignId: CAMPAIGN, deliverableId: DELIVERABLE } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='task' forwards all three ids to runTaskShow", async () => {
    const reg = await setup();
    await reg
      .getTool("campaign_inspect")!
      .handler(
        { verb: "task", campaignId: CAMPAIGN, deliverableId: DELIVERABLE, taskId: TASK },
        fakeContext
      );
    expect(taskMocks.runTaskShow).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN, deliverableId: DELIVERABLE, taskId: TASK })
    );
  });

  it("verb='users' lists the member directory", async () => {
    const reg = await setup();
    const result = await reg.getTool("campaign_inspect")!.handler({ verb: "users" }, fakeContext);
    expect(taskMocks.runCampaignUsers).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("7 user(s)");
  });
});

describe("campaign_manage — campaign resource", () => {
  it("registers with write auth + destructiveHint", async () => {
    const reg = await setup();
    const tool = reg.getTool("campaign_manage")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.destructiveHint).toBe(true);
  });

  it("campaign create requires a name", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("campaign_manage")!
        .handler({ resource: "campaign", verb: "create", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("campaign create forwards name + metadata to runCampaignCreate", async () => {
    const reg = await setup();
    await reg.getTool("campaign_manage")!.handler(
      {
        resource: "campaign",
        verb: "create",
        name: "Q2 launch",
        description: "Spring",
        brandkitId: "kit-1",
        allowWrite: true,
      },
      fakeContext
    );
    expect(taskMocks.runCampaignCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ name: "Q2 launch", brandkit_id: "kit-1" }),
      })
    );
  });

  it("campaign create reports a plan in what-if mode", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("campaign_manage")!
      .handler(
        { resource: "campaign", verb: "create", name: "Q2 launch", whatIf: true, allowWrite: true },
        fakeContext
      );
    expect(taskMocks.runCampaignCreate).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true })
    );
    expect(result.content[0].text).toContain("Plan: create");
  });

  it("campaign update is rejected (campaign supports create + delete only)", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("campaign_manage")!
        .handler(
          { resource: "campaign", verb: "update", campaignId: CAMPAIGN, allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("campaign delete requires campaignId", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("campaign_manage")!
        .handler({ resource: "campaign", verb: "delete", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("campaign delete reports 'Deleted' vs 'Plan' based on the runner result", async () => {
    const reg = await setup();
    const applied = await reg
      .getTool("campaign_manage")!
      .handler(
        { resource: "campaign", verb: "delete", campaignId: CAMPAIGN, allowWrite: true },
        fakeContext
      );
    expect(applied.content[0].text).toContain("Deleted campaign");

    taskMocks.runCampaignDelete.mockResolvedValueOnce({ id: CAMPAIGN, deleted: false });
    const planned = await reg.getTool("campaign_manage")!.handler(
      {
        resource: "campaign",
        verb: "delete",
        campaignId: CAMPAIGN,
        whatIf: true,
        allowWrite: true,
      },
      fakeContext
    );
    expect(planned.content[0].text).toContain("Plan: delete campaign");
  });
});

describe("campaign_manage — deliverable resource", () => {
  it("deliverable writes require a campaignId", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("campaign_manage")!
        .handler(
          { resource: "deliverable", verb: "create", name: "Hero", allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deliverable create forwards funnelStage + funnelTactics", async () => {
    const reg = await setup();
    await reg.getTool("campaign_manage")!.handler(
      {
        resource: "deliverable",
        verb: "create",
        campaignId: CAMPAIGN,
        name: "Hero banner",
        funnelStage: "TOP",
        funnelTactics: ["display", "social"],
        allowWrite: true,
      },
      fakeContext
    );
    expect(taskMocks.runDeliverableCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: CAMPAIGN,
        input: expect.objectContaining({
          funnel_stage: "TOP",
          funnel_tactics: ["display", "social"],
        }),
      })
    );
  });

  it("deliverable delete requires a deliverableId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("campaign_manage")!.handler(
        {
          resource: "deliverable",
          verb: "delete",
          campaignId: CAMPAIGN,
          allowWrite: true,
        } as never,
        fakeContext
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deliverable update is rejected", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("campaign_manage")!.handler(
        {
          resource: "deliverable",
          verb: "update",
          campaignId: CAMPAIGN,
          deliverableId: DELIVERABLE,
          allowWrite: true,
        } as never,
        fakeContext
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("campaign_manage — task resource", () => {
  it("task writes require campaignId and deliverableId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("campaign_manage")!.handler(
        {
          resource: "task",
          verb: "create",
          name: "Copy",
          campaignId: CAMPAIGN,
          allowWrite: true,
        } as never,
        fakeContext
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("task create forwards the name to runTaskCreate", async () => {
    const reg = await setup();
    await reg.getTool("campaign_manage")!.handler(
      {
        resource: "task",
        verb: "create",
        campaignId: CAMPAIGN,
        deliverableId: DELIVERABLE,
        name: "Draft copy",
        allowWrite: true,
      },
      fakeContext
    );
    expect(taskMocks.runTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ name: "Draft copy" }) })
    );
  });

  it("task update requires a taskId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("campaign_manage")!.handler(
        {
          resource: "task",
          verb: "update",
          campaignId: CAMPAIGN,
          deliverableId: DELIVERABLE,
          name: "Updated",
          allowWrite: true,
        } as never,
        fakeContext
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("task update forwards priority + assignee", async () => {
    const reg = await setup();
    await reg.getTool("campaign_manage")!.handler(
      {
        resource: "task",
        verb: "update",
        campaignId: CAMPAIGN,
        deliverableId: DELIVERABLE,
        taskId: TASK,
        name: "Refined copy",
        priority: "HIGH",
        assignee: "auth0|abc",
        allowWrite: true,
      },
      fakeContext
    );
    expect(taskMocks.runTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK,
        input: expect.objectContaining({ priority: "HIGH", assignee: "auth0|abc" }),
      })
    );
  });

  it("task delete requires a taskId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("campaign_manage")!.handler(
        {
          resource: "task",
          verb: "delete",
          campaignId: CAMPAIGN,
          deliverableId: DELIVERABLE,
          allowWrite: true,
        } as never,
        fakeContext
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("task delete reports 'Deleted' vs 'Plan' based on the runner result", async () => {
    const reg = await setup();
    const applied = await reg.getTool("campaign_manage")!.handler(
      {
        resource: "task",
        verb: "delete",
        campaignId: CAMPAIGN,
        deliverableId: DELIVERABLE,
        taskId: TASK,
        allowWrite: true,
      },
      fakeContext
    );
    expect(applied.content[0].text).toContain("Deleted task");

    taskMocks.runTaskDelete.mockResolvedValueOnce({ id: TASK, deleted: false });
    const planned = await reg.getTool("campaign_manage")!.handler(
      {
        resource: "task",
        verb: "delete",
        campaignId: CAMPAIGN,
        deliverableId: DELIVERABLE,
        taskId: TASK,
        whatIf: true,
        allowWrite: true,
      },
      fakeContext
    );
    expect(planned.content[0].text).toContain("Plan: delete task");
  });
});

describe("campaign_manage — allowWrite gating (dispatch)", () => {
  it("blocks a write when allowWrite is omitted, never reaching the runner", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const descriptor = reg.getTool("campaign_manage")!;
    const result = await dispatchTool(
      descriptor,
      { resource: "campaign", verb: "delete", campaignId: CAMPAIGN },
      { context: fakeContext, extra: fakeExtra }
    );
    expect(result.isError).toBe(true);
    expect(taskMocks.runCampaignDelete).not.toHaveBeenCalled();
  });

  it("runs the write when allowWrite is true", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const descriptor = reg.getTool("campaign_manage")!;
    const result = await dispatchTool(
      descriptor,
      { resource: "campaign", verb: "delete", campaignId: CAMPAIGN, allowWrite: true },
      { context: fakeContext, extra: fakeExtra }
    );
    expect(result.isError).toBeUndefined();
    expect(taskMocks.runCampaignDelete).toHaveBeenCalledTimes(1);
  });
});
