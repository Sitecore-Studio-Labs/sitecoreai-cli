import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";
import type { ToolExtra } from "../../../../src/mcp/registry";

/**
 * Brief MCP tools (`brief_inspect` / `brief_manage`). The brief task
 * runners are mocked — these tests verify the tool dispatch layer:
 * verb/resource routing, required-input validation (INPUT_INVALID),
 * the what-if plan vs apply text, and the allowWrite gate enforced by
 * the MCP dispatcher on write tools. Library behavior is covered
 * separately under tests/unit/brief/.
 */
const taskMocks = vi.hoisted(() => ({
  runBriefList: vi.fn().mockResolvedValue({
    totalCount: 3,
    data: [{ id: "b-1" }, { id: "b-2" }],
  }),
  runBriefShow: vi.fn().mockResolvedValue({
    id: "b-1",
    name: "Spring launch",
    status: "Draft",
    tasks: [{ id: "t-1" }],
    comments: [],
  }),
  runBriefTypes: vi.fn().mockResolvedValue({
    totalCount: 2,
    data: [{ name: "Campaign" }, { name: "Blog" }],
  }),
  runBriefTypeGet: vi
    .fn()
    .mockResolvedValue({ id: "bt-1", name: "Campaign", fields: [{ name: "f1" }] }),
  runBriefTodosList: vi.fn().mockResolvedValue({ totalCount: 5, data: [] }),
  runBriefCommentsList: vi.fn().mockResolvedValue({ totalCount: 1, data: [{ id: "c-1" }] }),
  runBriefSetStatus: vi.fn().mockResolvedValue({ id: "b-1", status: "InReview" }),
  runBriefDelete: vi.fn().mockResolvedValue({ id: "b-1", deleted: true }),
  runBriefCommentAdd: vi.fn().mockResolvedValue({ id: "c-new" }),
  runBriefTypeCreate: vi.fn().mockResolvedValue({ id: "bt-new", name: "Campaign" }),
  runBriefTypeUpdate: vi.fn().mockResolvedValue({ id: "bt-1" }),
  runBriefTypeDelete: vi.fn().mockResolvedValue({ id: "bt-1", deleted: true }),
}));

vi.mock("../../../../src/brief/tasks", () => taskMocks);

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

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const validBriefTypeBody = {
  name: "Campaign",
  label: { "en-us": "Campaign" },
  description: "A campaign brief.",
  icon: "rocket",
  iconColor: "#fff",
  fields: [],
};

const fakeExtra: ToolExtra = {
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
  for (const m of Object.values(taskMocks)) m.mockClear();
});

afterEach(async () => {
  const { __resetDispatchLockForTests } = await import("../../../../src/mcp/dispatch");
  __resetDispatchLockForTests();
});

describe("brief_inspect", () => {
  it("registers with read auth + readOnlyHint", async () => {
    const reg = await setup();
    const tool = reg.getTool("brief_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("verb='list' forwards limit + locale and reports the total count", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brief_inspect")!
      .handler({ verb: "list", limit: 50, locale: "en-us" }, fakeContext);
    expect(taskMocks.runBriefList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, locale: "en-us" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "list" });
    expect(result.content[0].text).toContain("3 brief(s)");
  });

  it("verb='show' requires briefId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brief_inspect")!.handler({ verb: "show" } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='show' forwards the briefId to runBriefShow", async () => {
    const reg = await setup();
    await reg.getTool("brief_inspect")!.handler({ verb: "show", briefId: UUID_A }, fakeContext);
    expect(taskMocks.runBriefShow).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: UUID_A })
    );
  });

  it("verb='type' requires briefTypeId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brief_inspect")!.handler({ verb: "type" } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='types' lists brief schemas", async () => {
    const reg = await setup();
    const result = await reg.getTool("brief_inspect")!.handler({ verb: "types" }, fakeContext);
    expect(taskMocks.runBriefTypes).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("Campaign");
  });

  it("verb='todos' reports tenant-wide vs per-brief in the summary text", async () => {
    const reg = await setup();
    const tenantWide = await reg.getTool("brief_inspect")!.handler({ verb: "todos" }, fakeContext);
    expect(tenantWide.content[0].text).toContain("tenant-wide");
    const perBrief = await reg
      .getTool("brief_inspect")!
      .handler({ verb: "todos", briefId: UUID_A }, fakeContext);
    expect(perBrief.content[0].text).toContain(UUID_A);
  });

  it("verb='comments' forwards an optional briefId filter", async () => {
    const reg = await setup();
    await reg.getTool("brief_inspect")!.handler({ verb: "comments", briefId: UUID_A }, fakeContext);
    expect(taskMocks.runBriefCommentsList).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: UUID_A })
    );
  });
});

describe("brief_manage", () => {
  it("registers with write auth + destructiveHint", async () => {
    const reg = await setup();
    const tool = reg.getTool("brief_manage")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.destructiveHint).toBe(true);
  });

  it("brief set-status requires briefId", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brief_manage")!
        .handler(
          { resource: "brief", verb: "set-status", status: "InReview", allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("brief set-status requires status", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brief_manage")!
        .handler(
          { resource: "brief", verb: "set-status", briefId: UUID_A, allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("brief set-status forwards whatIf and reports an apply result", async () => {
    const reg = await setup();
    const result = await reg.getTool("brief_manage")!.handler(
      {
        resource: "brief",
        verb: "set-status",
        briefId: UUID_A,
        status: "InReview",
        allowWrite: true,
      },
      fakeContext
    );
    expect(taskMocks.runBriefSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: UUID_A, status: "InReview", whatIf: undefined })
    );
    expect(result.content[0].text).toContain("status set to 'InReview'");
  });

  it("brief set-status surfaces a plan result in what-if mode", async () => {
    taskMocks.runBriefSetStatus.mockResolvedValueOnce({
      plan: { id: UUID_A, status: "InReview" },
    });
    const reg = await setup();
    const result = await reg.getTool("brief_manage")!.handler(
      {
        resource: "brief",
        verb: "set-status",
        briefId: UUID_A,
        status: "InReview",
        whatIf: true,
        allowWrite: true,
      },
      fakeContext
    );
    expect(result.content[0].text).toContain("Plan:");
  });

  it("brief delete reports 'Deleted' vs 'Plan' based on the runner result", async () => {
    const reg = await setup();
    const applied = await reg
      .getTool("brief_manage")!
      .handler(
        { resource: "brief", verb: "delete", briefId: UUID_A, allowWrite: true },
        fakeContext
      );
    expect(applied.content[0].text).toContain("Deleted brief");

    taskMocks.runBriefDelete.mockResolvedValueOnce({ id: UUID_A, deleted: false });
    const planned = await reg
      .getTool("brief_manage")!
      .handler(
        { resource: "brief", verb: "delete", briefId: UUID_A, whatIf: true, allowWrite: true },
        fakeContext
      );
    expect(planned.content[0].text).toContain("Plan: delete brief");
  });

  it("brief verb='create' is rejected (brief only supports set-status / delete)", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brief_manage")!
        .handler({ resource: "brief", verb: "create", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("comment create requires briefId and commentText", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brief_manage")!
        .handler(
          { resource: "comment", verb: "create", briefId: UUID_A, allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("comment create forwards the text to runBriefCommentAdd", async () => {
    const reg = await setup();
    await reg.getTool("brief_manage")!.handler(
      {
        resource: "comment",
        verb: "create",
        briefId: UUID_A,
        commentText: "LGTM",
        allowWrite: true,
      },
      fakeContext
    );
    expect(taskMocks.runBriefCommentAdd).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: UUID_A, text: "LGTM" })
    );
  });

  it("comment rejects verb!='create'", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brief_manage")!
        .handler(
          { resource: "comment", verb: "delete", briefId: UUID_A, allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("brief-type create requires a body", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brief_manage")!
        .handler({ resource: "brief-type", verb: "create", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("brief-type create forwards the body to runBriefTypeCreate", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brief_manage")!
      .handler(
        { resource: "brief-type", verb: "create", body: validBriefTypeBody, allowWrite: true },
        fakeContext
      );
    expect(taskMocks.runBriefTypeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: validBriefTypeBody })
    );
    expect(result.content[0].text).toContain("Created brief type 'Campaign'");
  });

  it("brief-type update requires both briefTypeId and body", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brief_manage")!.handler(
        {
          resource: "brief-type",
          verb: "update",
          body: validBriefTypeBody,
          allowWrite: true,
        } as never,
        fakeContext
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("brief-type delete forwards briefTypeId and reports the result", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brief_manage")!
      .handler(
        { resource: "brief-type", verb: "delete", briefTypeId: UUID_B, allowWrite: true },
        fakeContext
      );
    expect(taskMocks.runBriefTypeDelete).toHaveBeenCalledWith(
      expect.objectContaining({ briefTypeId: UUID_B })
    );
    expect(result.content[0].text).toContain("Deleted brief type");
  });

  it("rejects set-status on resource='brief-type'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brief_manage")!.handler(
        {
          resource: "brief-type",
          verb: "set-status",
          briefTypeId: UUID_B,
          allowWrite: true,
        } as never,
        fakeContext
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("brief_manage — allowWrite gating (dispatch)", () => {
  it("blocks a write when allowWrite is omitted, never reaching the handler", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const descriptor = reg.getTool("brief_manage")!;
    const result = await dispatchTool(
      descriptor,
      { resource: "brief", verb: "delete", briefId: UUID_A },
      { context: fakeContext, extra: fakeExtra }
    );
    expect(result.isError).toBe(true);
    expect(taskMocks.runBriefDelete).not.toHaveBeenCalled();
  });

  it("runs the write when allowWrite is true", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const descriptor = reg.getTool("brief_manage")!;
    const result = await dispatchTool(
      descriptor,
      { resource: "brief", verb: "delete", briefId: UUID_A, allowWrite: true },
      { context: fakeContext, extra: fakeExtra }
    );
    expect(result.isError).toBeUndefined();
    expect(taskMocks.runBriefDelete).toHaveBeenCalledTimes(1);
  });
});
