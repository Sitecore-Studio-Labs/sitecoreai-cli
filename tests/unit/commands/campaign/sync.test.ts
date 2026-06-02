import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai ops campaign sync …` command wiring. The recipe/sync engine and
 * the root-config reader are mocked; tests parse the commander command
 * tree and assert the slugified default filename, the not-found error,
 * the what-if/apply gate, and the `--prune` flag forwarding.
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

import { createCampaignSyncCommand } from "../../../../src/commands/campaign/sync";

const root = {
  defaultEnvironment: "agents",
  environments: { agents: { organizationId: "org_A", name: "agents" } },
};

const emptyPlan = { changes: [] };
const tally = { create: 0, update: 0, delete: 0, noop: 0 };

const runSync = async (args: string[]): Promise<void> => {
  const command = createCampaignSyncCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset().mockReturnValue(root);
  for (const m of Object.values(syncMocks)) m.mockReset();
  syncMocks.planIsNoop.mockReturnValue(true);
  syncMocks.summarizePlan.mockReturnValue(tally);
  syncMocks.syncPull.mockResolvedValue({ name: "Spring Launch" });
  syncMocks.syncDiff.mockResolvedValue(emptyPlan);
  syncMocks.syncPush.mockResolvedValue({ plan: emptyPlan, result: undefined });
  syncMocks.loadRecipe.mockReturnValue({ name: "Spring Launch" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("campaign sync pull", () => {
  it("captures the campaign and writes a slugified default filename", async () => {
    await runSync(["pull", "--campaign", "Spring Launch", "--quiet"]);
    expect(syncMocks.syncPull).toHaveBeenCalledWith(
      expect.objectContaining({ name: "campaign" }),
      expect.objectContaining({ kind: "campaign", id: "Spring Launch" }),
      expect.objectContaining({ environmentName: "agents" })
    );
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("spring-launch.campaign.yaml", {
      name: "Spring Launch",
    });
  });

  it("honors an explicit --file path", async () => {
    await runSync(["pull", "--campaign", "Spring Launch", "--file", "c/sl.yaml", "--quiet"]);
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("c/sl.yaml", { name: "Spring Launch" });
  });

  it("throws INPUT_INVALID when the campaign is not found", async () => {
    syncMocks.syncPull.mockResolvedValue(null);
    await expect(runSync(["pull", "--campaign", "Ghost", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(syncMocks.writeRecipe).not.toHaveBeenCalled();
  });
});

describe("campaign sync diff", () => {
  it("loads the recipe and diffs it against the environment", async () => {
    await runSync(["diff", "--file", "sl.yaml", "--quiet"]);
    expect(syncMocks.loadRecipe).toHaveBeenCalledWith("sl.yaml", expect.anything());
    expect(syncMocks.syncDiff).toHaveBeenCalledWith(
      expect.objectContaining({ name: "campaign" }),
      { name: "Spring Launch" },
      expect.objectContaining({ kind: "campaign", id: "Spring Launch" }),
      expect.anything()
    );
  });
});

describe("campaign sync push — what-if / apply / prune", () => {
  it("pushes in what-if mode without --allow-write", async () => {
    await runSync(["push", "--file", "sl.yaml", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "what-if", prune: undefined }
    );
  });

  it("pushes in apply mode and forwards --prune with --allow-write", async () => {
    await runSync(["push", "--file", "sl.yaml", "--allow-write", "--prune", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "apply", prune: true }
    );
  });
});
