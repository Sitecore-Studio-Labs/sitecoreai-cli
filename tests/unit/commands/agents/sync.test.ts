import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai agents sync …` command wiring. The recipe/sync engine and the
 * root-config reader are mocked; tests parse the commander command tree
 * and assert `--kind` resolution, default filename slugging, the
 * what-if/apply gate on `push`, and the not-found error on `pull`.
 */

const syncMocks = vi.hoisted(() => ({
  loadRecipe: vi.fn(),
  planIsNoop: vi.fn(),
  summarizePlan: vi.fn(),
  syncDiff: vi.fn(),
  syncPull: vi.fn(),
  syncPush: vi.fn(),
  writeRecipe: vi.fn(),
  // Identity passthrough — agents/recipe/index.ts uses eraseKind to
  // store typed RecipeKinds in a Record<RecipeKind<unknown>> map. The
  // tests don't exercise registry behaviour, so a no-op is enough.
  eraseKind: <T>(kind: T): T => kind,
  registerKind: vi.fn(),
}));

vi.mock("../../../../src/sync", () => syncMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

import { createAgentsSyncCommand } from "../../../../src/commands/agents/sync";

const root = {
  defaultEnvironment: "agents",
  environments: { agents: { organizationId: "org_A", name: "agents" } },
};

const emptyPlan = { changes: [] };
const tally = { create: 0, update: 0, delete: 0, noop: 0 };

const runSync = async (args: string[]): Promise<void> => {
  const command = createAgentsSyncCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset().mockReturnValue(root);
  for (const m of Object.values(syncMocks)) {
    if (typeof (m as { mockReset?: unknown }).mockReset === "function") {
      (m as { mockReset: () => void }).mockReset();
    }
  }
  syncMocks.planIsNoop.mockReturnValue(true);
  syncMocks.summarizePlan.mockReturnValue(tally);
  syncMocks.syncPull.mockResolvedValue({ name: "Research Agent" });
  syncMocks.syncDiff.mockResolvedValue(emptyPlan);
  syncMocks.syncPush.mockResolvedValue({ plan: emptyPlan, result: undefined });
  syncMocks.loadRecipe.mockReturnValue({ name: "Research Agent" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agents sync — --kind resolution", () => {
  it("throws INPUT_INVALID when --kind is missing", async () => {
    await expect(runSync(["pull", "--name", "X", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(syncMocks.syncPull).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID for an unknown --kind", async () => {
    await expect(
      runSync(["pull", "--name", "X", "--kind", "nonsense", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("accepts a known --kind and pulls the resource", async () => {
    await runSync(["pull", "--name", "Research Agent", "--kind", "agent", "--quiet"]);
    expect(syncMocks.syncPull).toHaveBeenCalledWith(
      expect.objectContaining({ name: "agent" }),
      expect.objectContaining({ kind: "agent", id: "Research Agent" }),
      expect.objectContaining({ environmentName: "agents" })
    );
  });
});

describe("agents sync pull", () => {
  it("writes to a slugified default filename when --file is omitted", async () => {
    await runSync(["pull", "--name", "Research Agent", "--kind", "agent", "--quiet"]);
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("research-agent.agent.yaml", {
      name: "Research Agent",
    });
  });

  it("honors an explicit --file path", async () => {
    await runSync([
      "pull",
      "--name",
      "Research Agent",
      "--kind",
      "agent",
      "--file",
      "out/x.yaml",
      "--quiet",
    ]);
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("out/x.yaml", { name: "Research Agent" });
  });

  it("throws INPUT_INVALID when the resource does not exist", async () => {
    syncMocks.syncPull.mockResolvedValue(null);
    await expect(
      runSync(["pull", "--name", "Ghost", "--kind", "skill", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(syncMocks.writeRecipe).not.toHaveBeenCalled();
  });
});

describe("agents sync diff", () => {
  it("loads the recipe with the kind schema and diffs it", async () => {
    await runSync(["diff", "--file", "x.yaml", "--kind", "widget", "--quiet"]);
    expect(syncMocks.loadRecipe).toHaveBeenCalledWith("x.yaml", expect.anything());
    expect(syncMocks.syncDiff).toHaveBeenCalledWith(
      expect.objectContaining({ name: "widget" }),
      { name: "Research Agent" },
      expect.objectContaining({ kind: "widget", id: "Research Agent" }),
      expect.anything()
    );
  });
});

describe("agents sync push — what-if / apply gate", () => {
  it("pushes in what-if mode by default", async () => {
    await runSync(["push", "--file", "x.yaml", "--kind", "agent", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "what-if" }
    );
  });

  it("pushes in apply mode with --allow-write", async () => {
    await runSync(["push", "--file", "x.yaml", "--kind", "agent", "--allow-write", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "apply" }
    );
  });
});
