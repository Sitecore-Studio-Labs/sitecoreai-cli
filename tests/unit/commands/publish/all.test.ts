import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai content publish all` command wiring. The whole-environment
 * publish task runner is mocked; tests parse the single-level command
 * the way the CLI does and assert the comma-split `--languages`
 * coercion, the `--mode` choice validation + default, numeric coercion
 * on the poll/timeout flags, the `--no-wait` boolean inversion, and
 * the action delegation.
 */

const taskMocks = vi.hoisted(() => ({
  runPublishAll: vi.fn(),
}));

vi.mock("../../../../src/publishing/tasks/all", () => taskMocks);

import { createPublishAllCommand } from "../../../../src/commands/publish/all";

const runPublishAll = async (args: string[]): Promise<void> => {
  const command = createPublishAllCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPublishAllCommand — option surface", () => {
  const command = createPublishAllCommand();

  it("declares the publish-scope and watch flags", () => {
    const longs = new Set(command.options.map((o) => o.long));
    for (const long of [
      "--languages",
      "--languages-from-site",
      "--all-tenant-languages",
      "--mode",
      "--confirm-token",
      "--yes",
      "--no-wait",
      "--poll-interval-s",
      "--timeout-s",
      "--name",
      "--source",
      "--allow-write",
      "--what-if",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("defaults --mode to Republish", () => {
    const mode = command.options.find((o) => o.long === "--mode");
    expect(mode?.defaultValue).toBe("Republish");
  });
});

describe("content publish all — option coercion", () => {
  it("dry-runs with defaults: empty languages, Republish mode, wait true", async () => {
    await runPublishAll(["--quiet"]);
    expect(taskMocks.runPublishAll).toHaveBeenCalledOnce();
    const call = taskMocks.runPublishAll.mock.calls[0][0];
    expect(call.languages).toEqual([]);
    expect(call.mode).toBe("Republish");
    expect(call.wait).toBe(true);
  });

  it("splits a comma-separated --languages list", async () => {
    await runPublishAll(["--languages", "en, da, fr", "--quiet"]);
    expect(taskMocks.runPublishAll).toHaveBeenCalledWith(
      expect.objectContaining({ languages: ["en", "da", "fr"] })
    );
  });

  it("rejects an invalid --mode choice", async () => {
    await expect(runPublishAll(["--mode", "Fast", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runPublishAll).not.toHaveBeenCalled();
  });

  it("coerces --poll-interval-s / --timeout-s to numbers and threads --confirm-token / --yes", async () => {
    await runPublishAll([
      "--mode",
      "Smart",
      "--confirm-token",
      "tok-123",
      "--yes",
      "--poll-interval-s",
      "10",
      "--timeout-s",
      "3600",
      "--name",
      "nightly-republish",
      "--source",
      "ci",
      "--allow-write",
      "--quiet",
    ]);
    expect(taskMocks.runPublishAll).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "Smart",
        confirmToken: "tok-123",
        yes: true,
        pollIntervalS: 10,
        timeoutS: 3600,
        name: "nightly-republish",
        source: "ci",
        allowWrite: true,
      })
    );
  });

  it("threads --no-wait as wait:false", async () => {
    await runPublishAll(["--no-wait", "--quiet"]);
    expect(taskMocks.runPublishAll).toHaveBeenCalledWith(expect.objectContaining({ wait: false }));
  });

  it("threads --languages-from-site and --all-tenant-languages locale-scope flags", async () => {
    await runPublishAll([
      "--languages-from-site",
      "Marketing",
      "--all-tenant-languages",
      "--quiet",
    ]);
    expect(taskMocks.runPublishAll).toHaveBeenCalledWith(
      expect.objectContaining({ languagesFromSite: "Marketing", allTenantLanguages: true })
    );
  });
});
