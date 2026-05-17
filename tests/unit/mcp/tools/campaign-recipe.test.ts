import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

// The campaign-recipe tools route to the sync engine; mock the three
// engine entry points and keep the rest of `@/sync` (summarizePlan,
// types) real.
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

import { McpRegistry } from "../../../../src/mcp/registry";
import { registerCampaignRecipeTools } from "../../../../src/mcp/tools/campaign-recipe";

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
  name: "Spring Launch",
  description: undefined,
  status: undefined,
  startDate: undefined,
  dueDate: undefined,
  brandKitId: undefined,
  labels: [],
  deliverables: [],
};

const setup = (): McpRegistry => {
  const registry = new McpRegistry();
  registerCampaignRecipeTools(registry);
  return registry;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("campaign recipe tools", () => {
  it("registers campaign_recipe_inspect and campaign_recipe_push", () => {
    const reg = setup();
    expect(reg.getTool("campaign_recipe_inspect")).toBeDefined();
    expect(reg.getTool("campaign_recipe_push")).toBeDefined();
  });

  it("marks the inspect tool read-only and the push tool destructive write", () => {
    const reg = setup();
    const inspect = reg.getTool("campaign_recipe_inspect")!;
    const push = reg.getTool("campaign_recipe_push")!;
    expect(inspect.auth).toBe("read");
    expect(inspect.annotations.readOnlyHint).toBe(true);
    expect(push.auth).toBe("write");
    expect(push.annotations.destructiveHint).toBe(true);
  });

  it("inspect verb=diff routes to syncDiff and returns the plan", async () => {
    const reg = setup();
    syncMocks.syncDiff.mockResolvedValue({
      changes: [{ kind: "update", path: "deliverables.A.tasks.B", summary: "A / B" }],
    });
    const result = await reg
      .getTool("campaign_recipe_inspect")!
      .handler({ verb: "diff", recipe }, fakeContext, fakeExtra);
    expect(syncMocks.syncDiff).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({
      verb: "diff",
      summary: { update: 1 },
    });
  });

  it("inspect verb=pull routes to syncPull and reports found", async () => {
    const reg = setup();
    syncMocks.syncPull.mockResolvedValue(recipe);
    const result = await reg
      .getTool("campaign_recipe_inspect")!
      .handler({ verb: "pull", campaignName: "Spring Launch" }, fakeContext, fakeExtra);
    expect(syncMocks.syncPull).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ verb: "pull", found: true });
  });

  it("inspect verb=pull without campaignName throws", async () => {
    const reg = setup();
    await expect(
      reg.getTool("campaign_recipe_inspect")!.handler({ verb: "pull" }, fakeContext, fakeExtra)
    ).rejects.toThrow(/campaignName/);
  });

  it("inspect verb=diff without recipe throws", async () => {
    const reg = setup();
    await expect(
      reg.getTool("campaign_recipe_inspect")!.handler({ verb: "diff" }, fakeContext, fakeExtra)
    ).rejects.toThrow(/recipe/);
  });

  it("push with whatIf=true runs the engine in what-if mode", async () => {
    const reg = setup();
    syncMocks.syncPush.mockResolvedValue({ plan: { changes: [] }, result: null });
    await reg
      .getTool("campaign_recipe_push")!
      .handler({ recipe, whatIf: true, allowWrite: false, prune: false }, fakeContext, fakeExtra);
    expect(syncMocks.syncPush).toHaveBeenCalledOnce();
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "what-if" });
  });

  it("push with whatIf=false runs the engine in apply mode", async () => {
    const reg = setup();
    syncMocks.syncPush.mockResolvedValue({
      plan: { changes: [] },
      result: { applied: [], skipped: [] },
    });
    await reg
      .getTool("campaign_recipe_push")!
      .handler({ recipe, whatIf: false, allowWrite: true, prune: false }, fakeContext, fakeExtra);
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "apply" });
  });
});
