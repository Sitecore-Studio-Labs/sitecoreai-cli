import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai content version set-never-publish` command wiring. The
 * version-never-publish task runner is mocked; tests parse the
 * single-level command the way the CLI does and assert the required
 * `--value` choice, numeric `--version` coercion, the `parseBoolFlag`
 * string→boolean coercion the action applies, and the item-targeting
 * flags.
 */

const taskMocks = vi.hoisted(() => ({
  runContentVersionSetNeverPublish: vi.fn(),
}));

vi.mock("../../../../../src/content/tasks/version-never-publish", () => taskMocks);

import { createSetNeverPublishCommand } from "../../../../../src/commands/content/version/set-never-publish";

const runSetNeverPublish = async (args: string[]): Promise<void> => {
  const command = createSetNeverPublishCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSetNeverPublishCommand — option surface", () => {
  const command = createSetNeverPublishCommand();

  it("declares the item-targeting and gating flags", () => {
    const longs = new Set(command.options.map((o) => o.long));
    for (const long of [
      "--item-id",
      "--path",
      "--language",
      "--version",
      "--value",
      "--confirm-token",
      "--yes",
      "--allow-write",
      "--what-if",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("marks --value as required", () => {
    const required = command.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--value"]);
  });
});

describe("content version set-never-publish", () => {
  it("rejects a missing required --value", async () => {
    await expect(
      runSetNeverPublish(["--path", "/sitecore/content/Home", "--quiet"])
    ).rejects.toBeDefined();
    expect(taskMocks.runContentVersionSetNeverPublish).not.toHaveBeenCalled();
  });

  it("rejects an invalid --value choice", async () => {
    await expect(
      runSetNeverPublish(["--path", "/sitecore/content/Home", "--value", "maybe", "--quiet"])
    ).rejects.toBeDefined();
    expect(taskMocks.runContentVersionSetNeverPublish).not.toHaveBeenCalled();
  });

  it("coerces --value 'true' to a boolean and threads --path", async () => {
    await runSetNeverPublish(["--path", "/sitecore/content/Home", "--value", "true", "--quiet"]);
    expect(taskMocks.runContentVersionSetNeverPublish).toHaveBeenCalledOnce();
    expect(taskMocks.runContentVersionSetNeverPublish).toHaveBeenCalledWith(
      expect.objectContaining({ value: true, path: "/sitecore/content/Home" })
    );
  });

  it("coerces --value 'false' to a boolean", async () => {
    await runSetNeverPublish([
      "--item-id",
      "{33333333-3333-3333-3333-333333333333}",
      "--value",
      "false",
      "--quiet",
    ]);
    expect(taskMocks.runContentVersionSetNeverPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        value: false,
        itemId: "{33333333-3333-3333-3333-333333333333}",
      })
    );
  });

  it("coerces --version to a number and threads --language / --confirm-token / --yes", async () => {
    await runSetNeverPublish([
      "--item-id",
      "abc",
      "--value",
      "true",
      "--version",
      "4",
      "--language",
      "en-US",
      "--confirm-token",
      "tok-9",
      "--yes",
      "--allow-write",
      "--quiet",
    ]);
    expect(taskMocks.runContentVersionSetNeverPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 4,
        language: "en-US",
        confirmToken: "tok-9",
        yes: true,
        allowWrite: true,
      })
    );
  });
});
