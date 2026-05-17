import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai brand sync …` command wiring. The recipe/sync engine and the
 * root-config reader are mocked; tests parse the commander command tree
 * and assert the slugified default filename, the not-found error, the
 * what-if/apply gate, the `--prune` flag, and the paid-pipeline warning.
 */

const syncMocks = vi.hoisted(() => ({
  loadRecipe: vi.fn(),
  planIsNoop: vi.fn(),
  summarizePlan: vi.fn(),
  syncDiff: vi.fn(),
  syncPull: vi.fn(),
  syncPush: vi.fn(),
  writeRecipe: vi.fn(),
}));

vi.mock("../../../../src/sync", () => syncMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

import { createBrandSyncCommand } from "../../../../src/commands/brand/sync";

const root = {
  defaultEnvironment: "sandbox",
  environments: { sandbox: { organizationId: "org_A", name: "sandbox" } },
};

const emptyPlan = { changes: [] };
const paidPlan = {
  changes: [{ kind: "update", summary: "ingest pdf", meta: { stage: "document" } }],
};
const tally = { create: 0, update: 1, delete: 0, noop: 0 };

const runSync = async (args: string[]): Promise<void> => {
  const command = createBrandSyncCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset().mockReturnValue(root);
  for (const m of Object.values(syncMocks)) m.mockReset();
  syncMocks.planIsNoop.mockReturnValue(true);
  syncMocks.summarizePlan.mockReturnValue(tally);
  syncMocks.syncPull.mockResolvedValue({ name: "Acme Co" });
  syncMocks.syncDiff.mockResolvedValue(emptyPlan);
  syncMocks.syncPush.mockResolvedValue({ plan: emptyPlan, result: undefined });
  syncMocks.loadRecipe.mockReturnValue({ name: "Acme Co" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("brand sync pull", () => {
  it("captures the kit via syncPull and writes a slugified default filename", async () => {
    await runSync(["pull", "--kit", "Acme Co", "--quiet"]);
    expect(syncMocks.syncPull).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brand-kit" }),
      expect.objectContaining({ kind: "brand-kit", id: "Acme Co" }),
      expect.objectContaining({ environmentName: "sandbox" })
    );
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("acme-co.brandkit.yaml", {
      name: "Acme Co",
    });
  });

  it("honors an explicit --file path", async () => {
    await runSync(["pull", "--kit", "Acme Co", "--file", "kits/acme.yaml", "--quiet"]);
    expect(syncMocks.writeRecipe).toHaveBeenCalledWith("kits/acme.yaml", { name: "Acme Co" });
  });

  it("throws INPUT_INVALID when the kit is not found", async () => {
    syncMocks.syncPull.mockResolvedValue(null);
    await expect(runSync(["pull", "--kit", "Ghost", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(syncMocks.writeRecipe).not.toHaveBeenCalled();
  });
});

describe("brand sync diff", () => {
  it("loads the recipe and diffs it against the environment", async () => {
    await runSync(["diff", "--file", "acme.yaml", "--quiet"]);
    expect(syncMocks.loadRecipe).toHaveBeenCalledWith("acme.yaml", expect.anything());
    expect(syncMocks.syncDiff).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brand-kit" }),
      { name: "Acme Co" },
      expect.objectContaining({ kind: "brand-kit", id: "Acme Co" }),
      expect.anything()
    );
  });

  it("warns when the plan would trigger paid AI pipelines", async () => {
    syncMocks.syncDiff.mockResolvedValue(paidPlan);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runSync(["diff", "--file", "acme.yaml"]);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/paid AI pipeline/);
  });
});

describe("brand sync push — what-if / apply / prune", () => {
  it("pushes in what-if mode without --allow-write", async () => {
    await runSync(["push", "--file", "acme.yaml", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "what-if", prune: undefined }
    );
  });

  it("pushes in apply mode and forwards --prune with --allow-write", async () => {
    await runSync(["push", "--file", "acme.yaml", "--allow-write", "--prune", "--quiet"]);
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mode: "apply", prune: true }
    );
  });
});
