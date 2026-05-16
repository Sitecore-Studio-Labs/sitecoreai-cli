import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";
import type { PublishAuditEntry } from "../../../../src/publishing/audit";
import type { PublishJob } from "../../../../src/publishing/api/types";

const fakeJob: PublishJob = {
  id: "job_abc",
  state: "running",
  canCancel: true,
  processedCount: 5,
  totalCount: 10,
  raw: {
    id: "job_abc",
    name: null,
    description: null,
    source: null,
    options: {},
    statistics: null,
    system: { tenantId: "t", status: "Running", createdBy: {} },
    permissions: { canViewDetails: true, canCancel: true },
  },
};

const taskMocks = vi.hoisted(() => ({
  resolveEnvironment: vi.fn().mockReturnValue({
    envName: "test-env",
    environment: {} as unknown,
    root: {} as unknown,
    timeoutMs: undefined,
  }),
  acquirePublishingToken: vi.fn().mockResolvedValue("tok"),
  getPublishJob: vi.fn(),
  listPublishJobs: vi.fn(),
  cancelPublishJob: vi.fn(),
  readRecentPublishAudit: vi.fn(),
  ensureMcpElevationAllowed: vi.fn(),
}));

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: taskMocks.resolveEnvironment,
}));
vi.mock("../../../../src/shared/allow-write", () => ({
  ensureMcpElevationAllowed: taskMocks.ensureMcpElevationAllowed,
}));
vi.mock("../../../../src/publishing/api/auth", () => ({
  acquirePublishingToken: taskMocks.acquirePublishingToken,
}));
vi.mock("../../../../src/publishing/api/client", () => ({
  getPublishJob: taskMocks.getPublishJob,
  listPublishJobs: taskMocks.listPublishJobs,
  cancelPublishJob: taskMocks.cancelPublishJob,
}));
vi.mock("../../../../src/publishing/audit", () => ({
  readRecentPublishAudit: taskMocks.readRecentPublishAudit,
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
  allowWriteEnabled: true,
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
  taskMocks.getPublishJob.mockReset();
  taskMocks.listPublishJobs.mockReset();
  taskMocks.cancelPublishJob.mockReset();
  taskMocks.readRecentPublishAudit.mockReset();
  taskMocks.ensureMcpElevationAllowed.mockReset();
  taskMocks.acquirePublishingToken.mockResolvedValue("tok");
});

describe("publish_inspect", () => {
  it("registers with read auth + readOnlyHint=true (no destructive ops on the inspect side)", async () => {
    const reg = await setup();
    const tool = reg.getTool("publish_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(false);
  });

  it("verb='status' requires a jobId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("publish_inspect")!.handler({ verb: "status" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='status' calls getPublishJob and returns the normalized job", async () => {
    taskMocks.getPublishJob.mockResolvedValue(fakeJob);
    const reg = await setup();
    const result = await reg
      .getTool("publish_inspect")!
      .handler({ verb: "status", jobId: "job_abc" }, fakeContext, fakeExtra);
    expect(taskMocks.getPublishJob).toHaveBeenCalledWith(expect.anything(), "job_abc");
    expect(result.structuredContent).toMatchObject({ verb: "status", job: { id: "job_abc" } });
  });

  it("verb='list-running' filters to Queued + Running states", async () => {
    taskMocks.listPublishJobs.mockResolvedValue([fakeJob]);
    const reg = await setup();
    await reg.getTool("publish_inspect")!.handler({ verb: "list-running" }, fakeContext, fakeExtra);
    expect(taskMocks.listPublishJobs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ statuses: ["Queued", "Running"] })
    );
  });

  it("verb='history' reads the audit log and applies filters", async () => {
    const entries: PublishAuditEntry[] = [
      {
        ts: "2026-05-14T22:00:00Z",
        command: "publish item",
        caller: { type: "human", via: "cli" },
        scope: { envName: "test-env", target: "Edge", kind: "item" },
        risk: "normal",
        scopeHash: "x",
        outcome: "ok",
        jobId: "job_a",
      },
      {
        ts: "2026-05-14T22:01:00Z",
        command: "publish all",
        caller: { type: "human", via: "cli" },
        scope: { envName: "other-env", target: "Edge", kind: "full" },
        risk: "high",
        scopeHash: "y",
        outcome: "error",
        errorCode: "NETWORK",
      },
    ];
    taskMocks.readRecentPublishAudit.mockReturnValue(entries);
    const reg = await setup();
    const result = await reg
      .getTool("publish_inspect")!
      .handler({ verb: "history", historyOutcome: "error" } as never, fakeContext, fakeExtra);
    expect(result.structuredContent).toMatchObject({
      verb: "history",
      count: 1,
      entries: [expect.objectContaining({ command: "publish all", outcome: "error" })],
    });
  });
});

describe("publish_lifecycle", () => {
  it("registers with write auth + destructiveHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("publish_lifecycle")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(tool.annotations.destructiveHint).toBe(true);
  });

  it("only exposes the `cancel` verb — submission verbs are CLI-only by design", async () => {
    const reg = await setup();
    const tool = reg.getTool("publish_lifecycle")!;
    const verbField = (
      tool.inputSchema as Record<string, { safeParse: (v: unknown) => { success: boolean } }>
    ).verb;
    // Empirical test: `cancel` parses; every submission verb rejects.
    expect(verbField.safeParse("cancel").success).toBe(true);
    for (const forbidden of ["submit_item", "submit_all", "submit", "unpublish", "publish"]) {
      expect(verbField.safeParse(forbidden).success).toBe(false);
    }
  });

  it("verb='cancel' enforces MCP elevation, calls cancelPublishJob, re-reads job state", async () => {
    taskMocks.cancelPublishJob.mockResolvedValue(undefined);
    taskMocks.getPublishJob.mockResolvedValue({ ...fakeJob, state: "cancelling" });
    const reg = await setup();
    const result = await reg
      .getTool("publish_lifecycle")!
      .handler({ verb: "cancel", jobId: "job_abc", allowWrite: true }, fakeContext, fakeExtra);
    expect(taskMocks.ensureMcpElevationAllowed).toHaveBeenCalled();
    expect(taskMocks.cancelPublishJob).toHaveBeenCalledWith(expect.anything(), "job_abc");
    expect(taskMocks.getPublishJob).toHaveBeenCalledWith(expect.anything(), "job_abc");
    expect(result.structuredContent).toMatchObject({
      verb: "cancel",
      job: { state: "cancelling" },
    });
  });
});

describe("publishing MCP surface — safety invariants", () => {
  it("does not register any submission tool (no submit_item / submit_all / publish_submit / unpublish)", async () => {
    const reg = await setup();
    const allTools = reg.listTools().map((t) => t.name);
    const forbidden = [
      "publish_submit",
      "publish_submit_item",
      "publish_submit_all",
      "publish_unpublish",
      "submit_item",
      "submit_all",
    ];
    for (const name of forbidden) {
      expect(allTools).not.toContain(name);
    }
  });

  it("does not expose unpublish anywhere on the publishing surface", async () => {
    const reg = await setup();
    const publishingTools = reg.listTools().filter((t) => t.name.startsWith("publish_"));
    expect(publishingTools.map((t) => t.name).sort()).toEqual([
      "publish_inspect",
      "publish_lifecycle",
    ]);
  });
});
