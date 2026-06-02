import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai ops brief sync …` command wiring. The recipe/sync engine and the
 * root-config reader are mocked; tests parse the commander command tree
 * and assert the slugified default filename, the not-found error, the
 * what-if/apply gate, and the `--prune` flag forwarding.
 */

const syncMocks = vi.hoisted(() => ({
  loadRecipe: vi.fn(),
  planIsNoop: vi.fn(),
  summarizePlan: vi.fn(),
  syncDiff: vi.fn(),
  syncPull: vi.fn(),
  syncPush: vi.fn(),
  resolveHttpBaselineStorageFromEnv: vi.fn(() => undefined),
  writeRecipe: vi.fn(),
}));

vi.mock("../../../../src/sync", () => syncMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

import { createBriefSyncCommand } from "../../../../src/commands/brief/sync";

const root = {
  defaultEnvironment: "agents",
  environments: { agents: { organizationId: "org_A", name: "agents" } },
};

const emptyPlan = { changes: [] };
const tally = { create: 0, update: 0, delete: 0, noop: 0 };

const runSync = async (args: string[]): Promise<void> => {
  const command = createBriefSyncCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset().mockReturnValue(root);
  for (const m of Object.values(syncMocks)) m.mockReset();
  syncMocks.planIsNoop.mockReturnValue(true);
  syncMocks.summarizePlan.mockReturnValue(tally);
  syncMocks.syncPull.mockResolvedValue({ name: "Creative Brief" });
  syncMocks.syncDiff.mockResolvedValue(emptyPlan);
  syncMocks.syncPush.mockResolvedValue({ plan: emptyPlan, result: undefined });
  syncMocks.loadRecipe.mockReturnValue({ name: "Creative Brief" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("brief sync pull", () => {
  it("captures the brief type and writes a slugified default filename", async () => {
    await runSync(["pull", "--name", "Creative Brief", "--quiet"]);
    expect(syncMocks.syncPull).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brief-type" }),
      expect.objectContaining({ kind: "brief-type", id: "Creative Brief" }),
      expect.objectContaining({ environmentName: "agents" })
    );
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("creative-brief.brieftype.yaml", {
      name: "Creative Brief",
    });
  });

  it("honors an explicit --file path", async () => {
    await runSync(["pull", "--name", "Creative Brief", "--file", "bt/cb.yaml", "--quiet"]);
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("bt/cb.yaml", { name: "Creative Brief" });
  });

  it("throws INPUT_INVALID when the brief type is not found", async () => {
    syncMocks.syncPull.mockResolvedValue(null);
    await expect(runSync(["pull", "--name", "Ghost", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(syncMocks.writeRecipe).not.toHaveBeenCalled();
  });
});

describe("brief sync diff", () => {
  it("loads the recipe and diffs it against the environment", async () => {
    await runSync(["diff", "--file", "cb.yaml", "--quiet"]);
    expect(syncMocks.loadRecipe).toHaveBeenCalledWith("cb.yaml", expect.anything());
    expect(syncMocks.syncDiff).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brief-type" }),
      { name: "Creative Brief" },
      expect.objectContaining({ kind: "brief-type", id: "Creative Brief" }),
      expect.anything()
    );
  });
});

describe("brief sync push — what-if / apply / prune", () => {
  it("pushes in what-if mode without --allow-write", async () => {
    await runSync(["push", "--file", "cb.yaml", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "what-if", prune: undefined }
    );
  });

  it("pushes in apply mode and forwards --prune with --allow-write", async () => {
    await runSync(["push", "--file", "cb.yaml", "--allow-write", "--prune", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "apply", prune: true }
    );
  });
});

describe("brief sync — --kind brief routes to the brief-instance kind", () => {
  it("pull --kind brief uses the briefInstanceKind ref and the .brief.yaml suffix", async () => {
    syncMocks.syncPull.mockResolvedValue({ name: "Q3 Launch" });
    await runSync(["pull", "--kind", "brief", "--name", "Q3 Launch", "--quiet"]);
    expect(syncMocks.syncPull).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brief" }),
      expect.objectContaining({ kind: "brief", id: "Q3 Launch" }),
      expect.anything()
    );
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("q3-launch.brief.yaml", {
      name: "Q3 Launch",
    });
  });

  it("pull defaults to --kind brief-type for back-compat with existing scripts", async () => {
    await runSync(["pull", "--name", "Creative Brief", "--quiet"]);
    expect(syncMocks.syncPull.mock.calls[0][0].name).toBe("brief-type");
  });

  it("diff --kind brief loads against the brief-instance schema and refs the kind", async () => {
    syncMocks.loadRecipe.mockReturnValue({ name: "Q3 Launch", briefTypeName: "CreativeBrief" });
    await runSync(["diff", "--kind", "brief", "--file", "q3.yaml", "--quiet"]);
    expect(syncMocks.syncDiff).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brief" }),
      { name: "Q3 Launch", briefTypeName: "CreativeBrief" },
      expect.objectContaining({ kind: "brief", id: "Q3 Launch" }),
      expect.anything()
    );
  });

  it("push --kind brief --allow-write applies via the brief-instance kind", async () => {
    syncMocks.loadRecipe.mockReturnValue({ name: "Q3 Launch", briefTypeName: "CreativeBrief" });
    await runSync(["push", "--kind", "brief", "--file", "q3.yaml", "--allow-write", "--quiet"]);
    expect(syncMocks.syncPush.mock.calls[0][0].name).toBe("brief");
    expect(syncMocks.syncPush.mock.calls[0][2]).toEqual({ kind: "brief", id: "Q3 Launch" });
    expect(syncMocks.syncPush.mock.calls[0][4]).toMatchObject({ mode: "apply" });
  });

  it("rejects an unknown --kind value at the parser level", async () => {
    await expect(
      runSync(["pull", "--kind", "garbage", "--name", "X", "--quiet"])
    ).rejects.toThrow();
  });
});
