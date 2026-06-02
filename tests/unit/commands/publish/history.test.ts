import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai content publish history` command wiring. Covers:
 *  - the local parseIntOpt helper (positive integer happy path + rejection on
 *    non-positive / non-numeric / NaN)
 *  - command option declarations (--env, --since, --command, --outcome, --scan-limit, --limit)
 *  - the --outcome choice constraint
 *  - the action delegating to runPublishHistory with parsed --scan-limit / --limit
 */

const taskMocks = vi.hoisted(() => ({
  runPublishHistory: vi.fn(),
}));

vi.mock("../../../../src/publishing/tasks/history", () => taskMocks);

import { createPublishHistoryCommand } from "../../../../src/commands/publish/history";

const runCmd = async (args: string[]): Promise<void> => {
  const command = createPublishHistoryCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  taskMocks.runPublishHistory.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPublishHistoryCommand — command shape", () => {
  const command = createPublishHistoryCommand();

  it("declares --env, --since, --command, --outcome, --scan-limit, --limit", () => {
    const longs = new Set(
      command.options.map((o) => o.long).filter((v): v is string => Boolean(v))
    );
    for (const long of ["--env", "--since", "--command", "--outcome", "--scan-limit", "--limit"]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("constrains --outcome to ok | error | cancelled", () => {
    const outcome = command.options.find((o) => o.long === "--outcome")!;
    expect(outcome.argChoices).toEqual(["ok", "error", "cancelled"]);
  });

  it("appends usage examples to the help text", () => {
    let out = "";
    command.configureOutput({ writeOut: (s) => (out += s) });
    command.outputHelp();
    expect(out).toContain("Examples:");
  });
});

describe("createPublishHistoryCommand — parseIntOpt branches", () => {
  it("parses a positive integer string for --scan-limit and --limit", async () => {
    await runCmd(["--quiet", "--scan-limit", "1000", "--limit", "25"]);
    expect(taskMocks.runPublishHistory).toHaveBeenCalledWith(
      expect.objectContaining({ scanLimit: 1000, limit: 25 })
    );
  });

  it("rejects a non-numeric --limit with a clear error", async () => {
    await expect(runCmd(["--quiet", "--limit", "notanumber"])).rejects.toThrow(
      /Expected positive integer.*notanumber/
    );
    expect(taskMocks.runPublishHistory).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative --scan-limit", async () => {
    await expect(runCmd(["--quiet", "--scan-limit", "0"])).rejects.toThrow(/positive integer/);
    await expect(runCmd(["--quiet", "--scan-limit", "-5"])).rejects.toThrow(/positive integer/);
    expect(taskMocks.runPublishHistory).not.toHaveBeenCalled();
  });
});

describe("createPublishHistoryCommand — action threading", () => {
  it("threads --env / --since / --command / --outcome through to the runner", async () => {
    await runCmd([
      "--quiet",
      "--env",
      "sandbox",
      "--since",
      "24h",
      "--command",
      "publish item",
      "--outcome",
      "ok",
    ]);
    expect(taskMocks.runPublishHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        env: "sandbox",
        since: "24h",
        command: "publish item",
        outcome: "ok",
      })
    );
  });

  it("rejects an --outcome value outside the constrained choice list", async () => {
    await expect(runCmd(["--quiet", "--outcome", "maybe"])).rejects.toBeDefined();
    expect(taskMocks.runPublishHistory).not.toHaveBeenCalled();
  });
});
