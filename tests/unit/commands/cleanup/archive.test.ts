import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene cleanup archive purge` command wiring. The
 * archive-purge task runner is mocked; tests walk the command tree,
 * assert numeric coercion on the count flags, the `--archive-name`
 * scoping flag, and the `--apply` dry-run gate (whatIf coerced true).
 */

const taskMocks = vi.hoisted(() => ({
  runCleanupArchivePurge: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/archive-purge", () => taskMocks);

import { createCleanupArchiveCommand } from "../../../../src/commands/cleanup/archive";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runArchive = async (args: string[]): Promise<void> => {
  const command = createCleanupArchiveCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
  // withApplyGate writes a "Dry run" hint to stderr — silence it.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCleanupArchiveCommand — command tree", () => {
  const archive = createCleanupArchiveCommand();

  it("registers the purge subcommand", () => {
    expect(sub(archive, "purge")).toBeDefined();
  });

  it("declares the count flags and --archive-name plus the cleanup base flags", () => {
    const purge = sub(archive, "purge")!;
    const longs = new Set(purge.options.map((o) => o.long));
    for (const long of [
      "--older-than-days",
      "--limit",
      "--archive-name",
      "--page-size",
      "--concurrency",
      "--apply",
      "--what-if",
      "--allow-write",
      "--force",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });
});

describe("cleanup archive purge", () => {
  it("dry-runs (whatIf coerced true) without --apply", async () => {
    await runArchive(["purge", "--quiet"]);
    expect(taskMocks.runCleanupArchivePurge).toHaveBeenCalledOnce();
    expect(taskMocks.runCleanupArchivePurge).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true })
    );
  });

  it("respects an explicit --what-if without coercing apply", async () => {
    await runArchive(["purge", "--what-if", "--quiet"]);
    const call = taskMocks.runCleanupArchivePurge.mock.calls[0][0];
    expect(call.whatIf).toBe(true);
    expect(call.apply).toBeUndefined();
  });

  it("coerces --older-than-days / --limit / --page-size / --concurrency to numbers under --apply", async () => {
    await runArchive([
      "purge",
      "--older-than-days",
      "90",
      "--limit",
      "2000",
      "--page-size",
      "250",
      "--concurrency",
      "8",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupArchivePurge.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      olderThanDays: 90,
      limit: 2000,
      pageSize: 250,
      concurrency: 8,
      apply: true,
    });
    expect(call.whatIf).toBeUndefined();
  });

  it("threads --archive-name through to scope the purge", async () => {
    await runArchive(["purge", "--archive-name", "RecycleBin", "--apply", "--quiet"]);
    expect(taskMocks.runCleanupArchivePurge).toHaveBeenCalledWith(
      expect.objectContaining({ archiveName: "RecycleBin", apply: true })
    );
  });
});
