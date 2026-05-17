import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai brand seed …` command wiring. The brand seed primitive, the
 * recipe/sync engine, and the root-config reader are mocked; tests parse
 * the commander command tree and assert the --url/--file source fork,
 * the resolveClient credential guards, numeric option coercion, and the
 * JSON vs human output fork.
 */

const brandMocks = vi.hoisted(() => ({
  seedBrandKit: vi.fn(),
}));

vi.mock("../../../../src/brand", () => brandMocks);

vi.mock("../../../../src/brand/recipe", () => ({
  brandKitKind: { name: "brand-kit", schema: {} },
}));

const syncMocks = vi.hoisted(() => ({
  loadRecipe: vi.fn(),
  syncPush: vi.fn(),
}));

vi.mock("../../../../src/sync", () => syncMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  resolveActiveEnvironment: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
  resolveActiveEnvironment: configMocks.resolveActiveEnvironment,
}));

import { createBrandSeedCommand } from "../../../../src/commands/brand/seed";

const rootWithCredential = {
  defaultEnvironment: "sandbox",
  environments: { sandbox: { organizationId: "org_A", name: "sandbox" } },
  brand: { org_A: { clientId: "cid" } },
};

const runSeed = async (args: string[]): Promise<void> => {
  const command = createBrandSeedCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset().mockReturnValue(rootWithCredential);
  configMocks.resolveActiveEnvironment.mockReset().mockReturnValue({
    envName: "sandbox",
    env: { organizationId: "org_A", name: "sandbox" },
    root: rootWithCredential,
  });
  brandMocks.seedBrandKit.mockReset().mockResolvedValue({
    kit: { id: "kit-1" },
    elapsedSec: 42,
    sections: [{ name: "Brand Context", order: 1 }],
  });
  syncMocks.loadRecipe.mockReset().mockReturnValue({ name: "acme" });
  syncMocks.syncPush.mockReset().mockResolvedValue({
    plan: { changes: [] },
    result: { applied: [], skipped: [] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("brand seed — source validation", () => {
  it("throws INPUT_INVALID when neither --url nor --file is given", async () => {
    await expect(runSeed(["--quiet"])).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(brandMocks.seedBrandKit).not.toHaveBeenCalled();
    expect(syncMocks.syncPush).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when both --url and --file are given", async () => {
    await expect(
      runSeed(["--url", "https://x.com/a.pdf", "--file", "acme.yaml", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when --url is passed without --name", async () => {
    await expect(runSeed(["--url", "https://x.com/a.pdf", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(brandMocks.seedBrandKit).not.toHaveBeenCalled();
  });
});

describe("brand seed --url — resolveClient guards", () => {
  it("throws INPUT_INVALID when no organizationId resolves", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { name: "sandbox" } },
      brand: {},
    });
    await expect(
      runSeed(["--name", "Acme", "--url", "https://x.com/a.pdf", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws AUTH_BRAND_REQUIRED when the org has no Brand credential", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { organizationId: "org_A", name: "sandbox" } },
      brand: {},
    });
    await expect(
      runSeed(["--name", "Acme", "--url", "https://x.com/a.pdf", "--quiet"])
    ).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
  });
});

describe("brand seed --url — pipeline delegation", () => {
  it("forwards name + source + metadata to seedBrandKit", async () => {
    await runSeed([
      "--name",
      "Acme",
      "--url",
      "https://x.com/a.pdf",
      "--description",
      "desc",
      "--industry",
      "tech",
      "--quiet",
    ]);
    expect(brandMocks.seedBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme",
        source: { url: "https://x.com/a.pdf" },
        description: "desc",
        industry: "tech",
      })
    );
  });

  it("coerces --poll-interval-sec and --timeout-sec to numbers", async () => {
    await runSeed([
      "--name",
      "Acme",
      "--url",
      "https://x.com/a.pdf",
      "--poll-interval-sec",
      "5",
      "--timeout-sec",
      "120",
      "--quiet",
    ]);
    expect(brandMocks.seedBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ pollIntervalSec: 5, timeoutSec: 120 })
    );
  });

  it("leaves poll/timeout undefined when the flags are omitted", async () => {
    await runSeed(["--name", "Acme", "--url", "https://x.com/a.pdf", "--quiet"]);
    const call = brandMocks.seedBrandKit.mock.calls.at(-1)?.[0];
    expect(call?.pollIntervalSec).toBeUndefined();
    expect(call?.timeoutSec).toBeUndefined();
  });

  it("emits the seed result as JSON to stdout with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSeed([
      "--name",
      "Acme",
      "--url",
      "https://x.com/a.pdf",
      "--format",
      "json",
      "--quiet",
    ]);
    const payload = JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0]).trim());
    expect(payload).toMatchObject({ kit: { id: "kit-1" }, elapsedSec: 42 });
  });

  it("forwards an explicit --org-id over the env profile", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { organizationId: "org_ENV", name: "sandbox" } },
      brand: { org_OVERRIDE: { clientId: "cid" } },
    });
    await runSeed([
      "--name",
      "Acme",
      "--url",
      "https://x.com/a.pdf",
      "--org-id",
      "org_OVERRIDE",
      "--quiet",
    ]);
    expect(brandMocks.seedBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({
        client: { orgId: "org_OVERRIDE", credential: { clientId: "cid" } },
      })
    );
  });
});

describe("brand seed --file — recipe converge path", () => {
  it("loads the recipe and pushes it in apply mode", async () => {
    await runSeed(["--file", "acme.yaml", "--quiet"]);
    expect(syncMocks.loadRecipe).toHaveBeenCalledWith("acme.yaml", expect.anything());
    expect(syncMocks.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brand-kit" }),
      { name: "acme" },
      expect.objectContaining({ kind: "brand-kit", id: "acme" }),
      expect.objectContaining({ environmentName: "sandbox" }),
      { mode: "apply", prune: false }
    );
    expect(brandMocks.seedBrandKit).not.toHaveBeenCalled();
  });

  it("emits the recipe/plan/result as JSON with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSeed(["--file", "acme.yaml", "--format", "json", "--quiet"]);
    const payload = JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0]).trim());
    expect(payload).toMatchObject({ recipe: "acme" });
  });
});
