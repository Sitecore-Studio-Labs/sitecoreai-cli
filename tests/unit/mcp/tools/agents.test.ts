import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

/**
 * Agentic Studio tools — `agents_inspect` (read, verb-discriminated) and
 * `agents_run` (write). The handlers route verb → an `@/agents/api/*`
 * primitive against a session resolved by `acquireAgentsSession`. These
 * tests mock the session factory + every API primitive so the routing,
 * each verb branch, the run-event accumulation, and the allowWrite gate
 * are exercised without a live BFF.
 */
const sessionMocks = vi.hoisted(() => ({
  acquireAgentsSession: vi.fn().mockResolvedValue({ baseUrl: "https://agents.test" }),
}));

const apiMocks = vi.hoisted(() => ({
  agentsRequest: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([{ slug: "writer", name: "Writer" }]),
  listSkills: vi.fn().mockResolvedValue([{ id: "s-1" }]),
  listTools: vi.fn().mockResolvedValue([{ id: "t-1" }, { id: "t-2" }]),
  listWidgets: vi.fn().mockResolvedValue([]),
  listSchemas: vi.fn().mockResolvedValue([{ id: "sc-1" }]),
  listCustomMcps: vi.fn().mockResolvedValue([{ id: "mcp-1" }]),
  runAgent: vi.fn(),
}));

vi.mock("../../../../src/agents/session", () => ({
  acquireAgentsSession: sessionMocks.acquireAgentsSession,
}));
vi.mock("../../../../src/agents/api/request", () => ({
  agentsRequest: apiMocks.agentsRequest,
}));
vi.mock("../../../../src/agents/api/agents", () => ({ listAgents: apiMocks.listAgents }));
vi.mock("../../../../src/agents/api/skills", () => ({ listSkills: apiMocks.listSkills }));
vi.mock("../../../../src/agents/api/tools", () => ({ listTools: apiMocks.listTools }));
vi.mock("../../../../src/agents/api/widgets", () => ({ listWidgets: apiMocks.listWidgets }));
vi.mock("../../../../src/agents/api/schemas", () => ({ listSchemas: apiMocks.listSchemas }));
vi.mock("../../../../src/agents/api/custom-mcps", () => ({
  listCustomMcps: apiMocks.listCustomMcps,
}));
vi.mock("../../../../src/agents/api/runs", () => ({ runAgent: apiMocks.runAgent }));

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

/** A finite async-iterable of run events for `runAgent`'s `events`. */
const eventStream = (events: ReadonlyArray<Record<string, unknown>>): AsyncIterable<unknown> => ({
  async *[Symbol.asyncIterator]() {
    for (const e of events) yield e;
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionMocks.acquireAgentsSession.mockResolvedValue({ baseUrl: "https://agents.test" });
});

describe("agents_inspect — registration", () => {
  it("registers with read auth + readOnlyHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("agents_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });
});

describe("agents_inspect — verb routing", () => {
  it("verb='agents' routes to listAgents and returns the result array", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "agents" }, fakeContext, fakeExtra);
    expect(apiMocks.listAgents).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ verb: "agents" });
    expect((result.structuredContent as { result: unknown[] }).result).toHaveLength(1);
  });

  it("verb='skills' routes to listSkills", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "skills" }, fakeContext, fakeExtra);
    expect(apiMocks.listSkills).toHaveBeenCalledOnce();
    expect((result.structuredContent as { verb: string }).verb).toBe("skills");
  });

  it("verb='tools' routes to listTools and counts the catalog", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "tools" }, fakeContext, fakeExtra);
    expect(apiMocks.listTools).toHaveBeenCalledOnce();
    expect(result.content[0]!.text).toContain("2 tool(s)");
  });

  it("verb='widgets' routes to listWidgets and tolerates an empty result", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "widgets" }, fakeContext, fakeExtra);
    expect(apiMocks.listWidgets).toHaveBeenCalledOnce();
    expect((result.structuredContent as { result: unknown[] }).result).toHaveLength(0);
    expect(result.content[0]!.text).toContain("0 widget(s)");
  });

  it("verb='schemas' routes to listSchemas", async () => {
    const reg = await setup();
    await reg.getTool("agents_inspect")!.handler({ verb: "schemas" }, fakeContext, fakeExtra);
    expect(apiMocks.listSchemas).toHaveBeenCalledOnce();
  });

  it("verb='mcps' routes to listCustomMcps", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "mcps" }, fakeContext, fakeExtra);
    expect(apiMocks.listCustomMcps).toHaveBeenCalledOnce();
    expect(result.content[0]!.text).toContain("1 custom MCP(s)");
  });

  it("verb='status' reports a valid session when token-refresh does not fail", async () => {
    apiMocks.agentsRequest.mockResolvedValueOnce({ success: true, expiresAt: "2030-01-01" });
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "status" }, fakeContext, fakeExtra);
    expect(apiMocks.agentsRequest).toHaveBeenCalledWith(expect.anything(), "/api/token-refresh");
    expect(result.structuredContent).toMatchObject({
      verb: "status",
      result: { valid: true, expiresAt: "2030-01-01", endpoint: "https://agents.test" },
    });
  });

  it("verb='status' reports an invalid session when token-refresh returns success=false", async () => {
    apiMocks.agentsRequest.mockResolvedValueOnce({ success: false });
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "status" }, fakeContext, fakeExtra);
    expect((result.structuredContent as { result: { valid: boolean } }).result.valid).toBe(false);
    expect(result.content[0]!.text).toContain("invalid");
  });

  it("verb='status' treats an absent refresh payload as a valid session", async () => {
    apiMocks.agentsRequest.mockResolvedValueOnce(undefined);
    const reg = await setup();
    const result = await reg
      .getTool("agents_inspect")!
      .handler({ verb: "status" }, fakeContext, fakeExtra);
    // `refresh?.success !== false` → undefined is not `false`, so valid.
    expect((result.structuredContent as { result: { valid: boolean } }).result.valid).toBe(true);
  });

  it("acquires the session against the bound env name", async () => {
    const reg = await setup();
    await reg.getTool("agents_inspect")!.handler({ verb: "agents" }, fakeContext, fakeExtra);
    expect(sessionMocks.acquireAgentsSession).toHaveBeenCalledWith("test-env");
  });
});

describe("agents_run — registration + auth", () => {
  it("registers with write auth + destructiveHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("agents_run")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(Object.keys(tool.inputSchema)).toContain("allowWrite");
  });
});

describe("agents_run — allowWrite gate (via dispatchTool)", () => {
  it("denies the run when allowWrite is not true", async () => {
    const reg = await setup();
    const { dispatchTool, __resetDispatchLockForTests } =
      await import("../../../../src/mcp/dispatch");
    const result = await dispatchTool(
      reg.getTool("agents_run")!,
      { agentSlug: "writer", message: "hi", allowWrite: false },
      { context: fakeContext, extra: fakeExtra }
    );
    __resetDispatchLockForTests();
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
    expect(apiMocks.runAgent).not.toHaveBeenCalled();
  });

  it("runs the agent when allowWrite is true", async () => {
    apiMocks.runAgent.mockResolvedValueOnce({
      spaceId: "space-1",
      events: eventStream([{ type: "text-delta", delta: "ok" }]),
    });
    const reg = await setup();
    const { dispatchTool, __resetDispatchLockForTests } =
      await import("../../../../src/mcp/dispatch");
    const result = await dispatchTool(
      reg.getTool("agents_run")!,
      { agentSlug: "writer", message: "hi", allowWrite: true },
      { context: fakeContext, extra: fakeExtra }
    );
    __resetDispatchLockForTests();
    expect(result.isError).toBeUndefined();
    expect(apiMocks.runAgent).toHaveBeenCalledOnce();
  });
});

describe("agents_run — event accumulation", () => {
  it("accumulates text-delta events into the output string", async () => {
    apiMocks.runAgent.mockResolvedValueOnce({
      spaceId: "space-7",
      events: eventStream([
        { type: "text-delta", delta: "Hello, " },
        { type: "text-delta", delta: "world" },
      ]),
    });
    const reg = await setup();
    const result = await reg
      .getTool("agents_run")!
      .handler({ agentSlug: "writer", message: "go", allowWrite: true }, fakeContext, fakeExtra);
    expect(apiMocks.runAgent).toHaveBeenCalledWith(expect.anything(), {
      agentSlug: "writer",
      message: "go",
    });
    const structured = result.structuredContent as {
      spaceId: string;
      output: string;
      eventCounts: Record<string, number>;
    };
    expect(structured.output).toBe("Hello, world");
    expect(structured.spaceId).toBe("space-7");
    expect(structured.eventCounts["text-delta"]).toBe(2);
  });

  it("accumulates data-artifactDelta content into the output", async () => {
    apiMocks.runAgent.mockResolvedValueOnce({
      spaceId: "space-8",
      events: eventStream([{ type: "data-artifactDelta", data: { content: "artifact body" } }]),
    });
    const reg = await setup();
    const result = await reg
      .getTool("agents_run")!
      .handler({ agentSlug: "writer", message: "go", allowWrite: true }, fakeContext, fakeExtra);
    expect((result.structuredContent as { output: string }).output).toBe("artifact body");
  });

  it("ignores a data-artifactDelta whose data has no string content", async () => {
    apiMocks.runAgent.mockResolvedValueOnce({
      spaceId: "space-9",
      events: eventStream([
        { type: "data-artifactDelta", data: { content: 42 } },
        { type: "text-delta", delta: "kept" },
      ]),
    });
    const reg = await setup();
    const result = await reg
      .getTool("agents_run")!
      .handler({ agentSlug: "writer", message: "go", allowWrite: true }, fakeContext, fakeExtra);
    expect((result.structuredContent as { output: string }).output).toBe("kept");
  });

  it("ignores a text-delta whose delta is not a string", async () => {
    apiMocks.runAgent.mockResolvedValueOnce({
      spaceId: "space-10",
      events: eventStream([{ type: "text-delta", delta: 123 }, { type: "tool-call" }]),
    });
    const reg = await setup();
    const result = await reg
      .getTool("agents_run")!
      .handler({ agentSlug: "writer", message: "go", allowWrite: true }, fakeContext, fakeExtra);
    const structured = result.structuredContent as {
      output: string;
      eventCounts: Record<string, number>;
    };
    expect(structured.output).toBe("");
    expect(structured.eventCounts["tool-call"]).toBe(1);
  });

  it("falls back to a 'Run completed' message when the stream emits no text", async () => {
    apiMocks.runAgent.mockResolvedValueOnce({
      spaceId: "space-11",
      events: eventStream([]),
    });
    const reg = await setup();
    const result = await reg
      .getTool("agents_run")!
      .handler({ agentSlug: "writer", message: "go", allowWrite: true }, fakeContext, fakeExtra);
    expect(result.content[0]!.text).toContain("Run completed");
    expect(result.content[0]!.text).toContain("space-11");
  });
});
