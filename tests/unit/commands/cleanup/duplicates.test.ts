import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene cleanup duplicates purge` command wiring. The
 * duplicates task runner and the stdin-envelope reader are mocked;
 * tests walk the command tree, assert numeric coercion on the count
 * flags, the `--keep-rule` choice validation + default, the `--apply`
 * dry-run gate, and the `--from-stdin` envelope branch (including the
 * non-array `envelope.data` rejection).
 */

const taskMocks = vi.hoisted(() => ({
  runCleanupDuplicates: vi.fn(),
}));

const envelopeMocks = vi.hoisted(() => ({
  readScaiEnvelopeFromStdin: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/duplicates", () => ({
  runCleanupDuplicates: taskMocks.runCleanupDuplicates,
}));
vi.mock("../../../../src/shared/envelope", () => ({
  readScaiEnvelopeFromStdin: envelopeMocks.readScaiEnvelopeFromStdin,
}));

import { createCleanupDuplicatesCommand } from "../../../../src/commands/cleanup/duplicates";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runDuplicates = async (args: string[]): Promise<void> => {
  const command = createCleanupDuplicatesCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  taskMocks.runCleanupDuplicates.mockReset().mockResolvedValue(undefined);
  envelopeMocks.readScaiEnvelopeFromStdin.mockReset();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCleanupDuplicatesCommand — command tree", () => {
  const duplicates = createCleanupDuplicatesCommand();

  it("registers the purge subcommand", () => {
    expect(sub(duplicates, "purge")).toBeDefined();
  });

  it("declares the count flags, --keep-rule, --from-stdin plus cleanup base flags", () => {
    const purge = sub(duplicates, "purge")!;
    const longs = new Set(purge.options.map((o) => o.long));
    for (const long of [
      "--root",
      "--language",
      "--min-group-size",
      "--limit",
      "--keep-rule",
      "--concurrency",
      "--batch-size",
      "--skip-ref-check",
      "--from-stdin",
      "--apply",
      "--what-if",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("defaults --keep-rule to 'oldest'", () => {
    const purge = sub(duplicates, "purge")!;
    const keepRule = purge.options.find((o) => o.long === "--keep-rule");
    expect(keepRule?.defaultValue).toBe("oldest");
  });
});

describe("cleanup duplicates purge — option coercion", () => {
  it("dry-runs (whatIf coerced true) without --apply and applies the keep-rule default", async () => {
    await runDuplicates(["purge", "--quiet"]);
    expect(taskMocks.runCleanupDuplicates).toHaveBeenCalledOnce();
    expect(taskMocks.runCleanupDuplicates).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true, keepRule: "oldest" })
    );
  });

  it("rejects an invalid --keep-rule choice", async () => {
    await expect(
      runDuplicates(["purge", "--keep-rule", "random", "--quiet"])
    ).rejects.toBeDefined();
    expect(taskMocks.runCleanupDuplicates).not.toHaveBeenCalled();
  });

  it("coerces --min-group-size / --limit / --concurrency / --batch-size to numbers under --apply", async () => {
    await runDuplicates([
      "purge",
      "--min-group-size",
      "3",
      "--limit",
      "8000",
      "--concurrency",
      "6",
      "--batch-size",
      "75",
      "--keep-rule",
      "newest",
      "--root",
      "/sitecore/content/Site",
      "--language",
      "fr",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupDuplicates.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      minGroupSize: 3,
      limit: 8000,
      concurrency: 6,
      batchSize: 75,
      keepRule: "newest",
      root: "/sitecore/content/Site",
      language: "fr",
      apply: true,
    });
    expect(call.whatIf).toBeUndefined();
  });
});

describe("cleanup duplicates purge — --from-stdin envelope branch", () => {
  it("reads the stdin envelope and forwards its data as preComputedGroups", async () => {
    const groups = [{ hash: "h1", items: [{ id: "a" }, { id: "b" }] }];
    envelopeMocks.readScaiEnvelopeFromStdin.mockResolvedValue({
      command: "audit duplicates list",
      data: groups,
    } as never);
    await runDuplicates(["purge", "--from-stdin", "--apply", "--quiet"]);
    expect(envelopeMocks.readScaiEnvelopeFromStdin).toHaveBeenCalledOnce();
    expect(taskMocks.runCleanupDuplicates).toHaveBeenCalledWith(
      expect.objectContaining({ preComputedGroups: groups, apply: true })
    );
  });

  it("throws when the stdin envelope data is not an array", async () => {
    envelopeMocks.readScaiEnvelopeFromStdin.mockResolvedValue({
      command: "audit duplicates list",
      data: { not: "an array" },
    } as never);
    await expect(runDuplicates(["purge", "--from-stdin", "--apply", "--quiet"])).rejects.toThrow(
      /not an array/
    );
    expect(taskMocks.runCleanupDuplicates).not.toHaveBeenCalled();
  });

  it("does not read stdin when --from-stdin is omitted", async () => {
    await runDuplicates(["purge", "--apply", "--quiet"]);
    expect(envelopeMocks.readScaiEnvelopeFromStdin).not.toHaveBeenCalled();
    const call = taskMocks.runCleanupDuplicates.mock.calls[0][0];
    expect(call.preComputedGroups).toBeUndefined();
  });
});
