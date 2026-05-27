import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai content version set-validity` command wiring. The task runner
 * is mocked; tests parse the single-level command and assert the
 * item-targeting flags, the four mutually-exclusive validity setters,
 * numeric `--version` coercion, and env / config / verbosity threading.
 */

const taskMocks = vi.hoisted(() => ({
  runContentVersionSetValidity: vi.fn(),
}));

vi.mock("../../../../../src/content/tasks/version-validity", () => taskMocks);

import { createSetValidityCommand } from "../../../../../src/commands/content/version/set-validity";

const runSetValidity = async (args: string[]): Promise<void> => {
  const command = createSetValidityCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSetValidityCommand — command shape", () => {
  const setValidity = createSetValidityCommand();

  it("declares the item-targeting, validity setter, and env / config flags", () => {
    const opts = new Set(
      setValidity.options.map((o) => o.long).filter((v): v is string => Boolean(v))
    );
    for (const long of [
      "--item-id",
      "--path",
      "--language",
      "--version",
      "--valid-from",
      "--clear-valid-from",
      "--valid-to",
      "--clear-valid-to",
      "--confirm-token",
      "--yes",
      "--environment-name",
      "--config",
      "--what-if",
      "--allow-write",
    ]) {
      expect(opts.has(long), long).toBe(true);
    }
  });

  it("calls out that this is a pure CM mutation that does not auto-publish", () => {
    expect(setValidity.description()).toContain("does NOT auto-publish");
  });
});

describe("content version set-validity", () => {
  it("threads --valid-from + --valid-to through to the runner", async () => {
    await runSetValidity([
      "--quiet",
      "--what-if",
      "--path",
      "/sitecore/content/Home",
      "--valid-from",
      "2026-12-31",
      "--valid-to",
      "2027-01-31T23:59:59Z",
    ]);
    expect(taskMocks.runContentVersionSetValidity).toHaveBeenCalledOnce();
    expect(taskMocks.runContentVersionSetValidity.mock.calls[0][0]).toMatchObject({
      path: "/sitecore/content/Home",
      validFrom: "2026-12-31",
      validTo: "2027-01-31T23:59:59Z",
      whatIf: true,
    });
  });

  it("threads clear-* flags through (write empty string semantics)", async () => {
    await runSetValidity([
      "--quiet",
      "--what-if",
      "--item-id",
      "11111111-1111-1111-1111-111111111111",
      "--clear-valid-from",
      "--clear-valid-to",
    ]);
    expect(taskMocks.runContentVersionSetValidity).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "11111111-1111-1111-1111-111111111111",
        clearValidFrom: true,
        clearValidTo: true,
      })
    );
  });

  it("coerces --version to a number", async () => {
    await runSetValidity([
      "--quiet",
      "--what-if",
      "--path",
      "/sitecore/content/Home",
      "--version",
      "4",
      "--valid-from",
      "2026-12-31",
    ]);
    expect(taskMocks.runContentVersionSetValidity).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4 })
    );
  });

  it("threads --confirm-token + --yes through", async () => {
    await runSetValidity([
      "--quiet",
      "--what-if",
      "--path",
      "/sitecore/content/Home",
      "--valid-to",
      "2026-12-31",
      "--confirm-token",
      "tok-abc",
      "--yes",
    ]);
    expect(taskMocks.runContentVersionSetValidity).toHaveBeenCalledWith(
      expect.objectContaining({ confirmToken: "tok-abc", yes: true })
    );
  });
});
