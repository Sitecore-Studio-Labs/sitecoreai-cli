import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai content publish status [jobId]` command wiring. Covers:
 *  - command-shape declarations (optional jobId, --watch flag,
 *    --poll-interval-s + --timeout-s parsed integers)
 *  - parseIntOpt rejection branches (non-numeric, zero, negative)
 *  - the action threading the optional jobId positional through to the task
 */

const taskMocks = vi.hoisted(() => ({
  runPublishStatus: vi.fn(),
}));

vi.mock("../../../../src/publishing/tasks/status", () => taskMocks);

import { createPublishStatusCommand } from "../../../../src/commands/publish/status";

const runCmd = async (args: string[]): Promise<void> => {
  const command = createPublishStatusCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  taskMocks.runPublishStatus.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPublishStatusCommand — command shape", () => {
  const command = createPublishStatusCommand();

  it("accepts [jobId] as an optional positional", () => {
    expect(command.registeredArguments.length).toBe(1);
    expect(command.registeredArguments[0].required).toBe(false);
    expect(command.registeredArguments[0].name()).toBe("jobId");
  });

  it("declares --watch + --poll-interval-s + --timeout-s + env/config/verbosity", () => {
    const longs = new Set(
      command.options.map((o) => o.long).filter((v): v is string => Boolean(v))
    );
    for (const long of [
      "--watch",
      "--poll-interval-s",
      "--timeout-s",
      "--environment-name",
      "--config",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("appends usage examples to the help text", () => {
    let out = "";
    command.configureOutput({ writeOut: (s) => (out += s) });
    command.outputHelp();
    expect(out).toContain("Examples:");
  });
});

describe("createPublishStatusCommand — parseIntOpt branches", () => {
  it("parses positive integers for --poll-interval-s + --timeout-s", async () => {
    await runCmd(["--quiet", "--poll-interval-s", "10", "--timeout-s", "600"]);
    expect(taskMocks.runPublishStatus).toHaveBeenCalledWith(
      expect.objectContaining({ pollIntervalS: 10, timeoutS: 600 })
    );
  });

  it("rejects a non-numeric --poll-interval-s", async () => {
    await expect(runCmd(["--quiet", "--poll-interval-s", "fast"])).rejects.toThrow(
      /positive integer/
    );
    expect(taskMocks.runPublishStatus).not.toHaveBeenCalled();
  });

  it("rejects zero or negative timeout-s", async () => {
    await expect(runCmd(["--quiet", "--timeout-s", "0"])).rejects.toThrow(/positive integer/);
    await expect(runCmd(["--quiet", "--timeout-s", "-1"])).rejects.toThrow(/positive integer/);
  });
});

describe("createPublishStatusCommand — action threading", () => {
  it("delegates to runPublishStatus with the optional jobId positional resolved", async () => {
    await runCmd(["job_abc", "--quiet", "--watch"]);
    expect(taskMocks.runPublishStatus).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job_abc", watch: true })
    );
  });

  it("delegates with jobId=undefined when no positional is given (list mode)", async () => {
    await runCmd(["--quiet"]);
    const call = taskMocks.runPublishStatus.mock.calls[0][0];
    expect(call.jobId).toBeUndefined();
  });
});
