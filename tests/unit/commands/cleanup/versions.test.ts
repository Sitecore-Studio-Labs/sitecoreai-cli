import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene cleanup versions <prune|archive>` command wiring. The
 * version-prune / version-archive task runners are mocked; tests walk
 * the command tree, assert the required-option enforcement on
 * `--keep` / `--root`, numeric coercion on the count flags, the
 * `--apply` dry-run gate (whatIf coerced true), and the archive-only
 * `--archive-name` flag.
 */

const taskMocks = vi.hoisted(() => ({
  runCleanupVersionsPrune: vi.fn(),
  runCleanupVersionsArchive: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/versions-prune", () => ({
  runCleanupVersionsPrune: taskMocks.runCleanupVersionsPrune,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/versions-archive", () => ({
  runCleanupVersionsArchive: taskMocks.runCleanupVersionsArchive,
}));

import { createCleanupVersionsCommand } from "../../../../src/commands/cleanup/versions";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runVersions = async (args: string[]): Promise<void> => {
  const command = createCleanupVersionsCommand();
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

describe("createCleanupVersionsCommand — command tree", () => {
  const versions = createCleanupVersionsCommand();

  it("registers prune and archive", () => {
    expect(sub(versions, "prune")).toBeDefined();
    expect(sub(versions, "archive")).toBeDefined();
  });

  it("marks --keep + --root as required on prune", () => {
    const prune = sub(versions, "prune")!;
    const required = prune.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(expect.arrayContaining(["--keep", "--root"]));
  });

  it("marks --keep + --root as required on archive", () => {
    const archive = sub(versions, "archive")!;
    const required = archive.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(expect.arrayContaining(["--keep", "--root"]));
  });

  it("declares --archive-name on archive but not on prune", () => {
    const archiveLongs = new Set(sub(versions, "archive")!.options.map((o) => o.long));
    const pruneLongs = new Set(sub(versions, "prune")!.options.map((o) => o.long));
    expect(archiveLongs.has("--archive-name")).toBe(true);
    expect(pruneLongs.has("--archive-name")).toBe(false);
  });
});

describe("cleanup versions prune", () => {
  it("rejects a missing required --root", async () => {
    await expect(runVersions(["prune", "--keep", "5", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runCleanupVersionsPrune).not.toHaveBeenCalled();
  });

  it("dry-runs (whatIf coerced true) without --apply", async () => {
    await runVersions(["prune", "--keep", "5", "--root", "/sitecore/content", "--quiet"]);
    expect(taskMocks.runCleanupVersionsPrune).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true, keep: 5, root: "/sitecore/content" })
    );
  });

  it("coerces --keep / --limit / --concurrency to numbers and applies with --apply", async () => {
    await runVersions([
      "prune",
      "--keep",
      "3",
      "--root",
      "/sitecore/content/Site",
      "--limit",
      "1000",
      "--concurrency",
      "12",
      "--language",
      "da",
      "--index",
      "master_index",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupVersionsPrune.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      keep: 3,
      limit: 1000,
      concurrency: 12,
      language: "da",
      index: "master_index",
      apply: true,
    });
    expect(call.whatIf).toBeUndefined();
  });
});

describe("cleanup versions archive", () => {
  it("dry-runs without --apply and threads --archive-name", async () => {
    await runVersions([
      "archive",
      "--keep",
      "2",
      "--root",
      "/sitecore/content",
      "--archive-name",
      "VersionArchive",
      "--quiet",
    ]);
    expect(taskMocks.runCleanupVersionsArchive).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true, keep: 2, archiveName: "VersionArchive" })
    );
  });

  it("applies the archive with --apply and --include-system", async () => {
    await runVersions([
      "archive",
      "--keep",
      "1",
      "--root",
      "/sitecore/content",
      "--include-system",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupVersionsArchive.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({ keep: 1, includeSystem: true, apply: true });
  });

  it("coerces archive --limit / --concurrency to numbers and threads --language / --index", async () => {
    await runVersions([
      "archive",
      "--keep",
      "4",
      "--root",
      "/sitecore/content",
      "--limit",
      "800",
      "--concurrency",
      "6",
      "--language",
      "fr",
      "--index",
      "custom_index",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupVersionsArchive.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      keep: 4,
      limit: 800,
      concurrency: 6,
      language: "fr",
      index: "custom_index",
    });
  });
});
