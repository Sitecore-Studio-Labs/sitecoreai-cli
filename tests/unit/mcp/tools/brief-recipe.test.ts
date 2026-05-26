import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

// The brief-recipe tools route to the sync engine; mock the three engine
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

import { McpRegistry } from "../../../../src/mcp/registry";
import { registerBriefRecipeTools } from "../../../../src/mcp/tools/brief-recipe";

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
  name: "CreativeBrief",
  label: { "en-us": "Creative Brief" },
  description: "A brief for creative work.",
  icon: "mdi-pencil",
  iconColor: "#3366FF",
  fields: [],
};

const briefInstanceRecipe = {
  name: "Q3 Launch",
  briefTypeName: "CreativeBrief",
  status: "Draft" as const,
  fields: {},
};

const setup = (): McpRegistry => {
  const registry = new McpRegistry();
  registerBriefRecipeTools(registry);
  return registry;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brief recipe tools", () => {
  it("registers brief_recipe_inspect and brief_recipe_push", () => {
    const reg = setup();
    expect(reg.getTool("brief_recipe_inspect")).toBeDefined();
    expect(reg.getTool("brief_recipe_push")).toBeDefined();
  });

  it("brief_recipe_inspect is a read tool, brief_recipe_push is a destructive write tool", () => {
    const reg = setup();
    const inspect = reg.getTool("brief_recipe_inspect")!;
    const push = reg.getTool("brief_recipe_push")!;
    expect(inspect.auth).toBe("read");
    expect(inspect.annotations.readOnlyHint).toBe(true);
    expect(push.auth).toBe("write");
    expect(push.annotations.destructiveHint).toBe(true);
  });

  it("inspect verb=diff routes to syncDiff and returns the plan", async () => {
    const reg = setup();
    syncMocks.syncDiff.mockResolvedValue({
      changes: [{ kind: "update", path: "briefType.description", summary: "description" }],
    });
    const result = await reg
      .getTool("brief_recipe_inspect")!
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
      .getTool("brief_recipe_inspect")!
      .handler({ verb: "pull", name: "CreativeBrief" }, fakeContext, fakeExtra);
    expect(syncMocks.syncPull).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ verb: "pull", found: true });
  });

  it("inspect verb=pull without name throws", async () => {
    const reg = setup();
    await expect(
      reg.getTool("brief_recipe_inspect")!.handler({ verb: "pull" }, fakeContext, fakeExtra)
    ).rejects.toThrow(/name/);
  });

  it("inspect verb=diff without recipe throws", async () => {
    const reg = setup();
    await expect(
      reg.getTool("brief_recipe_inspect")!.handler({ verb: "diff" }, fakeContext, fakeExtra)
    ).rejects.toThrow(/recipe/);
  });

  it("push with whatIf=true runs the engine in what-if mode", async () => {
    const reg = setup();
    syncMocks.syncPush.mockResolvedValue({ plan: { changes: [] }, result: null });
    await reg
      .getTool("brief_recipe_push")!
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
      .getTool("brief_recipe_push")!
      .handler({ recipe, whatIf: false, allowWrite: true, prune: false }, fakeContext, fakeExtra);
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "apply" });
  });
});

describe("brief recipe tools — kind discriminator routes to the right kind", () => {
  it("inspect verb=pull with kind='brief' routes to briefInstanceKind", async () => {
    const reg = setup();
    syncMocks.syncPull.mockResolvedValue(briefInstanceRecipe);
    const result = await reg
      .getTool("brief_recipe_inspect")!
      .handler({ verb: "pull", kind: "brief", name: "Q3 Launch" }, fakeContext, fakeExtra);

    // The engine entry point gets the brief-instance kind ('brief'), not 'brief-type'.
    expect(syncMocks.syncPull.mock.calls[0][0].name).toBe("brief");
    expect(syncMocks.syncPull.mock.calls[0][1]).toEqual({ kind: "brief", id: "Q3 Launch" });
    expect(result.structuredContent).toMatchObject({ kind: "brief", verb: "pull", found: true });
    expect(result.content[0].text).toContain('Captured brief "Q3 Launch"');
  });

  it("inspect verb=pull defaults kind to 'brief-type' for back-compat", async () => {
    const reg = setup();
    syncMocks.syncPull.mockResolvedValue(recipe);
    await reg
      .getTool("brief_recipe_inspect")!
      .handler({ verb: "pull", name: "CreativeBrief" }, fakeContext, fakeExtra);

    // No `kind` passed — default applies.
    expect(syncMocks.syncPull.mock.calls[0][0].name).toBe("brief-type");
  });

  it("inspect verb=diff accepts a brief-instance recipe under kind='brief'", async () => {
    const reg = setup();
    syncMocks.syncDiff.mockResolvedValue({
      changes: [{ kind: "create", path: "brief", summary: "create" }],
    });
    const result = await reg
      .getTool("brief_recipe_inspect")!
      .handler(
        { verb: "diff", kind: "brief", recipe: briefInstanceRecipe },
        fakeContext,
        fakeExtra
      );
    expect(syncMocks.syncDiff.mock.calls[0][0].name).toBe("brief");
    expect(syncMocks.syncDiff.mock.calls[0][2]).toEqual({ kind: "brief", id: "Q3 Launch" });
    expect(result.structuredContent).toMatchObject({ kind: "brief", verb: "diff" });
  });

  it("push with kind='brief' routes to briefInstanceKind", async () => {
    const reg = setup();
    syncMocks.syncPush.mockResolvedValue({ plan: { changes: [] }, result: null });
    await reg.getTool("brief_recipe_push")!.handler(
      {
        kind: "brief",
        recipe: briefInstanceRecipe,
        whatIf: true,
        allowWrite: false,
        prune: false,
      },
      fakeContext,
      fakeExtra
    );
    expect(syncMocks.syncPush.mock.calls[0][0].name).toBe("brief");
    expect(syncMocks.syncPush.mock.calls[0][2]).toEqual({ kind: "brief", id: "Q3 Launch" });
  });
});
