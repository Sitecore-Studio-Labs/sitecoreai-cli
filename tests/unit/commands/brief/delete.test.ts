import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai ops brief delete <briefId>` command wiring. Mocks the task
 * runner + the destructive-confirm shim, then walks the four action
 * paths: dry-run (no --apply, returns whatIf to the task), apply +
 * confirm-yes, apply + confirm-no (logs "Aborted." + does not call
 * the task), and apply + --force (skips the confirm prompt).
 */

const taskMocks = vi.hoisted(() => ({
  runBriefDelete: vi.fn(),
  confirmDestructive: vi.fn(),
}));

vi.mock("../../../../src/brief/tasks", () => ({
  runBriefDelete: taskMocks.runBriefDelete,
}));
vi.mock("../../../../src/shared/cli-tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/shared/cli-tasks")>();
  return { ...actual, confirmDestructive: taskMocks.confirmDestructive };
});

import { createBriefDeleteCommand } from "../../../../src/commands/brief/delete";

const runCmd = async (args: string[]): Promise<void> => {
  const command = createBriefDeleteCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  taskMocks.runBriefDelete.mockReset().mockResolvedValue(undefined);
  taskMocks.confirmDestructive.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBriefDeleteCommand — command shape", () => {
  const command = createBriefDeleteCommand();

  it("declares --apply + --what-if + --force + --config + --environment-name + --org-id", () => {
    const longs = new Set(
      command.options.map((o) => o.long).filter((v): v is string => Boolean(v))
    );
    for (const long of [
      "--apply",
      "--what-if",
      "--force",
      "--config",
      "--environment-name",
      "--org-id",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("declares <briefId> as a required positional", () => {
    expect(command.registeredArguments.length).toBe(1);
    expect(command.registeredArguments[0].required).toBe(true);
    expect(command.registeredArguments[0].name()).toBe("briefId");
  });
});

describe("createBriefDeleteCommand — action paths", () => {
  it("forces whatIf when --apply absent and skips the destructive confirm", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runCmd(["brief-1", "--quiet"]);
    expect(taskMocks.confirmDestructive).not.toHaveBeenCalled();
    expect(taskMocks.runBriefDelete).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: "brief-1", whatIf: true })
    );
    stderr.mockRestore();
  });

  it("prompts the destructive confirm with --apply, runs delete on yes", async () => {
    taskMocks.confirmDestructive.mockResolvedValue(true);
    await runCmd(["brief-2", "--quiet", "--apply"]);
    expect(taskMocks.confirmDestructive).toHaveBeenCalledOnce();
    expect(taskMocks.runBriefDelete).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: "brief-2", apply: true })
    );
  });

  it("aborts (no runBriefDelete + 'Aborted.' on stderr) when the confirm returns false", async () => {
    taskMocks.confirmDestructive.mockResolvedValue(false);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runCmd(["brief-3", "--quiet", "--apply"]);
    expect(taskMocks.runBriefDelete).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("Aborted.\n");
    stderr.mockRestore();
  });

  it("threads --force into confirmDestructive (which skips the TTY prompt for non-interactive callers)", async () => {
    await runCmd(["brief-4", "--quiet", "--apply", "--force"]);
    expect(taskMocks.confirmDestructive).toHaveBeenCalledWith(
      expect.stringMatching(/Delete brief brief-4/i),
      true
    );
    expect(taskMocks.runBriefDelete).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: "brief-4", force: true, apply: true })
    );
  });
});
