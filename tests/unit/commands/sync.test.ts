import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

/**
 * `scai sync …` — the cross-domain recipe aggregate. The aggregate
 * engine (`aggregatePull` / `aggregateStatus` / `aggregatePush`), the
 * enumerable-kinds list, and the root-config reader are mocked; tests
 * parse the commander command tree and assert the `--dir` default, the
 * kind list forwarding, the what-if/apply gate, and the `--prune` flag.
 */

const aggregateMocks = vi.hoisted(() => ({
  aggregatePull: vi.fn(),
  aggregateStatus: vi.fn(),
  aggregatePush: vi.fn(),
  DEFAULT_SYNC_DIR: ".scai/sync",
}));

vi.mock("../../../src/sync", () => aggregateMocks);

const kindsMock = vi.hoisted(() => ({
  ENUMERABLE_RECIPE_KINDS: [{ name: "brand-kit" }, { name: "brief-type" }],
}));

vi.mock("../../../src/sync/aggregate-kinds", () => kindsMock);

const KINDS = kindsMock.ENUMERABLE_RECIPE_KINDS;

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

import { createSyncCommand } from "../../../src/commands/sync";

const root = {
  defaultEnvironment: "agents",
  environments: { agents: { organizationId: "org_A", name: "agents" } },
};

const runSync = async (args: string[]): Promise<void> => {
  const command = createSyncCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset().mockReturnValue(root);
  aggregateMocks.aggregatePull
    .mockReset()
    .mockResolvedValue({ kinds: [], total: 0, dir: ".scai/sync" });
  aggregateMocks.aggregateStatus.mockReset().mockResolvedValue({ kinds: [], drifted: 0 });
  aggregateMocks.aggregatePush
    .mockReset()
    .mockResolvedValue({ kinds: [], mode: "what-if", applied: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sync pull", () => {
  it("fans out over the enumerable kinds with the default --dir", async () => {
    await runSync(["pull", "--quiet"]);
    expect(aggregateMocks.aggregatePull).toHaveBeenCalledWith(
      KINDS,
      expect.objectContaining({ environmentName: "agents" }),
      { dir: ".scai/sync" }
    );
  });

  it("forwards an explicit --dir", async () => {
    await runSync(["pull", "--dir", "custom/dir", "--quiet"]);
    expect(aggregateMocks.aggregatePull).toHaveBeenCalledWith(KINDS, expect.anything(), {
      dir: "custom/dir",
    });
  });

  it("uses an explicit -n environment over the config default", async () => {
    await runSync(["pull", "-n", "staging", "--quiet"]);
    expect(aggregateMocks.aggregatePull).toHaveBeenCalledWith(
      KINDS,
      expect.objectContaining({ environmentName: "staging" }),
      expect.anything()
    );
  });
});

describe("sync status", () => {
  it("diffs the workspace against the environment", async () => {
    await runSync(["status", "--dir", "w", "--quiet"]);
    expect(aggregateMocks.aggregateStatus).toHaveBeenCalledWith(KINDS, expect.anything(), {
      dir: "w",
    });
  });

  it("reports drift counts in the human summary", async () => {
    aggregateMocks.aggregateStatus.mockResolvedValue({
      kinds: [
        {
          kind: "brand-kit",
          items: [{ id: "acme", status: "drift", summary: { create: 1, update: 2, delete: 0 } }],
        },
      ],
      drifted: 1,
    });
    const info = vi.spyOn(consola, "info").mockReturnValue(undefined as never);
    const warn = vi.spyOn(consola, "warn").mockReturnValue(undefined as never);
    await runSync(["status"]);
    const lines = [...info.mock.calls, ...warn.mock.calls].map((c) => String(c[0])).join("\n");
    expect(lines).toMatch(/1 recipe\(s\) drifted/);
    expect(lines).toMatch(/acme/);
  });
});

describe("sync push — what-if / apply gate", () => {
  it("runs in what-if mode without --allow-write and prune defaults off", async () => {
    await runSync(["push", "--quiet"]);
    expect(aggregateMocks.aggregatePush).toHaveBeenCalledWith(KINDS, expect.anything(), {
      dir: ".scai/sync",
      mode: "what-if",
      prune: false,
    });
  });

  it("runs in apply mode and forwards --prune with --allow-write", async () => {
    aggregateMocks.aggregatePush.mockResolvedValue({ kinds: [], mode: "apply", applied: 3 });
    await runSync(["push", "--allow-write", "--prune", "--quiet"]);
    expect(aggregateMocks.aggregatePush).toHaveBeenCalledWith(KINDS, expect.anything(), {
      dir: ".scai/sync",
      mode: "apply",
      prune: true,
    });
  });
});
