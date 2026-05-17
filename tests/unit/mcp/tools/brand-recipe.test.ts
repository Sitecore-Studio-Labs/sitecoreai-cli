import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

// The brand-recipe tools route to the sync engine; mock the three engine
// entry points and keep the rest of `@/sync` (summarizePlan, types) real.
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

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: { environmentId: "e-1", host: "https://e.test" } as never,
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

const recipe = {
  name: "Acme",
  description: undefined,
  industry: undefined,
  documents: [],
  sections: {},
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brand recipe tools", () => {
  it("registers brand_recipe_inspect and brand_recipe_push", async () => {
    const reg = await setup();
    expect(reg.getTool("brand_recipe_inspect")).toBeDefined();
    expect(reg.getTool("brand_recipe_push")).toBeDefined();
  });

  it("inspect verb=diff routes to syncDiff and returns the plan", async () => {
    const reg = await setup();
    syncMocks.syncDiff.mockResolvedValue({
      changes: [{ kind: "update", path: "sections.A.B", summary: "A / B" }],
    });
    const result = await reg
      .getTool("brand_recipe_inspect")!
      .handler({ verb: "diff", recipe }, fakeContext, fakeExtra);
    expect(syncMocks.syncDiff).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({
      verb: "diff",
      summary: { update: 1 },
    });
  });

  it("inspect verb=pull routes to syncPull and reports found", async () => {
    const reg = await setup();
    syncMocks.syncPull.mockResolvedValue(recipe);
    const result = await reg
      .getTool("brand_recipe_inspect")!
      .handler({ verb: "pull", kitName: "Acme" }, fakeContext, fakeExtra);
    expect(syncMocks.syncPull).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ verb: "pull", found: true });
  });

  it("inspect verb=pull without kitName throws", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brand_recipe_inspect")!.handler({ verb: "pull" }, fakeContext, fakeExtra)
    ).rejects.toThrow(/kitName/);
  });

  it("push with whatIf=true runs the engine in what-if mode", async () => {
    const reg = await setup();
    syncMocks.syncPush.mockResolvedValue({ plan: { changes: [] }, result: null });
    await reg
      .getTool("brand_recipe_push")!
      .handler({ recipe, whatIf: true, allowWrite: false, prune: false }, fakeContext, fakeExtra);
    expect(syncMocks.syncPush).toHaveBeenCalledOnce();
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "what-if" });
  });

  it("push with whatIf=false runs the engine in apply mode", async () => {
    const reg = await setup();
    syncMocks.syncPush.mockResolvedValue({
      plan: { changes: [] },
      result: { applied: [], skipped: [] },
    });
    await reg
      .getTool("brand_recipe_push")!
      .handler({ recipe, whatIf: false, allowWrite: true, prune: false }, fakeContext, fakeExtra);
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "apply" });
  });
});
