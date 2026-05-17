import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

/**
 * Agentic Studio recipe tools — `agents_recipe_inspect` (read; verb
 * pull/diff) and `agents_recipe_push` (write; whatIf/apply). Each
 * discriminates on `kind` and routes to the `@/sync` engine. We mock
 * the three engine entry points (keeping `summarizePlan` + types real)
 * and stub `agentRecipeKindByName` so every `kind` resolves to a kind
 * object with a controllable `schema.parse`.
 */
const syncMocks = vi.hoisted(() => ({
  syncPull: vi.fn(),
  syncDiff: vi.fn(),
  syncPush: vi.fn(),
}));
vi.mock("../../../../src/sync", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../src/sync")>("../../../../src/sync");
  return { ...actual, ...syncMocks };
});

const recipeMocks = vi.hoisted(() => ({
  // `schema.parse` echoes its input by default; tests override per-call.
  parse: vi.fn((v: unknown) => v),
}));

// The handler reads `agentRecipeKindByName[input.kind]` then calls
// `kind.schema.parse(...)` and `kind.name`. Stub every kind to the same
// controllable object.
vi.mock("../../../../src/agents/recipe", () => {
  const makeKind = (name: string) => ({ name, schema: { parse: recipeMocks.parse } });
  return {
    agentRecipeKindByName: {
      agent: makeKind("agent"),
      skill: makeKind("skill"),
      widget: makeKind("widget"),
      "custom-mcp": makeKind("custom-mcp"),
      schema: makeKind("schema"),
      "html-template": makeKind("html-template"),
    },
  };
});

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

const emptyPlan = { changes: [] as unknown[] };
const writingPlan = {
  changes: [
    { kind: "create", path: "agents/x", summary: "x" },
    { kind: "update", path: "agents/y", summary: "y" },
  ],
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

beforeEach(() => {
  vi.clearAllMocks();
  recipeMocks.parse.mockImplementation((v: unknown) => v);
});

describe("agents_recipe — registration", () => {
  it("registers agents_recipe_inspect as a read tool", async () => {
    const reg = await setup();
    const tool = reg.getTool("agents_recipe_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("registers agents_recipe_push as a destructive write tool", async () => {
    const reg = await setup();
    const tool = reg.getTool("agents_recipe_push")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(Object.keys(tool.inputSchema)).toContain("allowWrite");
    expect(Object.keys(tool.inputSchema)).toContain("whatIf");
  });
});

describe("agents_recipe_inspect — verb=pull", () => {
  it("verb='pull' without `name` throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("agents_recipe_inspect")!
        .handler({ kind: "agent", verb: "pull" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(syncMocks.syncPull).not.toHaveBeenCalled();
  });

  it("verb='pull' routes to syncPull and reports found=true with a recipe", async () => {
    syncMocks.syncPull.mockResolvedValue({ name: "Writer" });
    const reg = await setup();
    const result = await reg
      .getTool("agents_recipe_inspect")!
      .handler({ kind: "agent", verb: "pull", name: "Writer" }, fakeContext, fakeExtra);
    expect(syncMocks.syncPull).toHaveBeenCalledOnce();
    // KindRef is the 2nd arg: { kind, id }.
    expect(syncMocks.syncPull.mock.calls[0][1]).toEqual({ kind: "agent", id: "Writer" });
    expect(result.structuredContent).toMatchObject({
      kind: "agent",
      verb: "pull",
      found: true,
    });
    expect(result.content[0]!.text).toContain('Captured "Writer"');
  });

  it("verb='pull' reports found=false when syncPull returns null", async () => {
    syncMocks.syncPull.mockResolvedValue(null);
    const reg = await setup();
    const result = await reg
      .getTool("agents_recipe_inspect")!
      .handler({ kind: "skill", verb: "pull", name: "Nope" }, fakeContext, fakeExtra);
    expect(result.structuredContent).toMatchObject({ found: false, recipe: null });
    expect(result.content[0]!.text).toContain('No skill named "Nope"');
  });
});

describe("agents_recipe_inspect — verb=diff", () => {
  it("verb='diff' without `recipe` throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("agents_recipe_inspect")!
        .handler({ kind: "agent", verb: "diff" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(syncMocks.syncDiff).not.toHaveBeenCalled();
  });

  it("verb='diff' rejects a recipe with no `name` (INPUT_INVALID from recipeName)", async () => {
    // schema.parse strips name → recipeName() throws.
    recipeMocks.parse.mockReturnValue({});
    const reg = await setup();
    await expect(
      reg
        .getTool("agents_recipe_inspect")!
        .handler({ kind: "agent", verb: "diff", recipe: { foo: 1 } }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='diff' routes to syncDiff and returns the plan + summary", async () => {
    recipeMocks.parse.mockReturnValue({ name: "Writer" });
    syncMocks.syncDiff.mockResolvedValue(writingPlan);
    const reg = await setup();
    const result = await reg
      .getTool("agents_recipe_inspect")!
      .handler({ kind: "agent", verb: "diff", recipe: { name: "Writer" } }, fakeContext, fakeExtra);
    expect(syncMocks.syncDiff).toHaveBeenCalledOnce();
    expect(syncMocks.syncDiff.mock.calls[0][2]).toEqual({ kind: "agent", id: "Writer" });
    expect(result.structuredContent).toMatchObject({
      kind: "agent",
      verb: "diff",
      summary: { create: 1, update: 1, delete: 0, noop: 0 },
    });
  });

  it("verb='diff' on an empty plan summarizes all-zero", async () => {
    recipeMocks.parse.mockReturnValue({ name: "Empty" });
    syncMocks.syncDiff.mockResolvedValue(emptyPlan);
    const reg = await setup();
    const result = await reg
      .getTool("agents_recipe_inspect")!
      .handler({ kind: "widget", verb: "diff", recipe: { name: "Empty" } }, fakeContext, fakeExtra);
    expect(result.structuredContent).toMatchObject({
      summary: { create: 0, update: 0, delete: 0, noop: 0 },
    });
  });
});

describe("agents_recipe_push — apply vs what-if", () => {
  it("whatIf=true runs syncPush in what-if mode and reports the plan", async () => {
    recipeMocks.parse.mockReturnValue({ name: "Writer" });
    syncMocks.syncPush.mockResolvedValue({ plan: writingPlan, result: null });
    const reg = await setup();
    const result = await reg
      .getTool("agents_recipe_push")!
      .handler(
        { kind: "agent", recipe: { name: "Writer" }, whatIf: true, allowWrite: false },
        fakeContext,
        fakeExtra
      );
    expect(syncMocks.syncPush).toHaveBeenCalledOnce();
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "what-if" });
    expect(result.structuredContent).toMatchObject({
      kind: "agent",
      mode: "what-if",
      result: null,
      summary: { create: 1, update: 1 },
    });
    expect(result.content[0]!.text).toContain("Plan:");
  });

  it("whatIf=false runs syncPush in apply mode and reports applied/skipped counts", async () => {
    recipeMocks.parse.mockReturnValue({ name: "Writer" });
    syncMocks.syncPush.mockResolvedValue({
      plan: writingPlan,
      result: { applied: ["a", "b"], skipped: ["c"] },
    });
    const reg = await setup();
    const result = await reg
      .getTool("agents_recipe_push")!
      .handler(
        { kind: "skill", recipe: { name: "Writer" }, whatIf: false, allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "apply" });
    expect(result.structuredContent).toMatchObject({ kind: "skill", mode: "apply" });
    expect(result.content[0]!.text).toBe("Applied 2 change(s); 1 skipped.");
  });

  it("rejects a recipe missing `name` with INPUT_INVALID", async () => {
    recipeMocks.parse.mockReturnValue({});
    const reg = await setup();
    await expect(
      reg
        .getTool("agents_recipe_push")!
        .handler(
          { kind: "agent", recipe: { foo: 1 }, whatIf: true, allowWrite: false },
          fakeContext,
          fakeExtra
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(syncMocks.syncPush).not.toHaveBeenCalled();
  });

  it("threads the abort signal into the sync context", async () => {
    recipeMocks.parse.mockReturnValue({ name: "Writer" });
    syncMocks.syncPush.mockResolvedValue({ plan: emptyPlan, result: null });
    const aborter = new AbortController();
    const reg = await setup();
    await reg
      .getTool("agents_recipe_push")!
      .handler(
        { kind: "agent", recipe: { name: "Writer" }, whatIf: true, allowWrite: false },
        fakeContext,
        { ...fakeExtra, signal: aborter.signal }
      );
    // The SyncContext (3rd arg) carries the signal.
    expect(syncMocks.syncPush.mock.calls[0][3]).toMatchObject({ signal: aborter.signal });
  });

  it("denies the push via dispatchTool when allowWrite is not true", async () => {
    recipeMocks.parse.mockReturnValue({ name: "Writer" });
    const reg = await setup();
    const { dispatchTool, __resetDispatchLockForTests } =
      await import("../../../../src/mcp/dispatch");
    const result = await dispatchTool(
      reg.getTool("agents_recipe_push")!,
      { kind: "agent", recipe: { name: "Writer" }, whatIf: false, allowWrite: false },
      { context: fakeContext, extra: fakeExtra }
    );
    __resetDispatchLockForTests();
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
    expect(syncMocks.syncPush).not.toHaveBeenCalled();
  });
});

describe("agents_recipe — kind coverage", () => {
  it("every kind in the enum resolves and routes through syncPull", async () => {
    const reg = await setup();
    const kinds = ["agent", "skill", "widget", "custom-mcp", "schema", "html-template"];
    for (const kind of kinds) {
      syncMocks.syncPull.mockResolvedValueOnce({ name: kind });
      await reg
        .getTool("agents_recipe_inspect")!
        .handler({ kind, verb: "pull", name: kind }, fakeContext, fakeExtra);
    }
    expect(syncMocks.syncPull).toHaveBeenCalledTimes(kinds.length);
  });
});
