import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

// recipe_sync routes to the cross-domain aggregate; mock the three
// aggregate entry points and keep the rest of `@/sync` real.
const aggMocks = vi.hoisted(() => ({
  aggregatePull: vi.fn(),
  aggregateStatus: vi.fn(),
  aggregatePush: vi.fn(),
}));
vi.mock("../../../../src/sync", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../src/sync")>("../../../../src/sync");
  return { ...actual, ...aggMocks };
});

import { McpRegistry } from "../../../../src/mcp/registry";
import { registerRecipeSyncTools } from "../../../../src/mcp/tools/recipe-sync";

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

const setup = (): McpRegistry => {
  const registry = new McpRegistry();
  registerRecipeSyncTools(registry);
  return registry;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recipe_sync tool", () => {
  it("registers recipe_sync as a destructive write tool with a verb enum", () => {
    const reg = setup();
    const tool = reg.getTool("recipe_sync")!;
    expect(tool).toBeDefined();
    expect(tool.auth).toBe("write");
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(Object.keys(tool.inputSchema)).toContain("allowWrite");
    const verb = tool.inputSchema.verb as unknown as { options: string[] };
    expect(verb.options).toEqual(["pull", "status", "push"]);
  });

  it("verb=pull routes to aggregatePull", async () => {
    const reg = setup();
    aggMocks.aggregatePull.mockResolvedValue({ dir: ".scai/sync", kinds: [], total: 3 });
    const result = await reg
      .getTool("recipe_sync")!
      .handler(
        { verb: "pull", prune: false, whatIf: false, allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(aggMocks.aggregatePull).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ verb: "pull", total: 3 });
  });

  it("verb=status routes to aggregateStatus", async () => {
    const reg = setup();
    aggMocks.aggregateStatus.mockResolvedValue({ dir: ".scai/sync", kinds: [], drifted: 0 });
    const result = await reg
      .getTool("recipe_sync")!
      .handler(
        { verb: "status", prune: false, whatIf: false, allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(aggMocks.aggregateStatus).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ verb: "status", drifted: 0 });
  });

  it("verb=push with whatIf=true runs the aggregate in what-if mode", async () => {
    const reg = setup();
    aggMocks.aggregatePush.mockResolvedValue({
      dir: ".scai/sync",
      mode: "what-if",
      kinds: [],
      applied: 0,
    });
    await reg
      .getTool("recipe_sync")!
      .handler(
        { verb: "push", prune: false, whatIf: true, allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(aggMocks.aggregatePush.mock.calls[0][2]).toMatchObject({ mode: "what-if" });
  });

  it("verb=push with whatIf=false runs the aggregate in apply mode", async () => {
    const reg = setup();
    aggMocks.aggregatePush.mockResolvedValue({
      dir: ".scai/sync",
      mode: "apply",
      kinds: [],
      applied: 5,
    });
    const result = await reg
      .getTool("recipe_sync")!
      .handler(
        { verb: "push", prune: true, whatIf: false, allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(aggMocks.aggregatePush.mock.calls[0][2]).toMatchObject({ mode: "apply", prune: true });
    expect(result.structuredContent).toMatchObject({ verb: "push", applied: 5 });
  });
});
