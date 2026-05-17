import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene cleanup subtree delete` command wiring. The subtree
 * cleanup task runner is mocked; tests walk the command tree, assert
 * the required-option enforcement on `--path`, the comma-separated
 * `--fields` accumulator, numeric coercion on `--max-deletions`, the
 * `--orphan-external-refs` mode, and the `--apply` dry-run gate.
 */

const taskMocks = vi.hoisted(() => ({
  runCleanupSubtree: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/subtree", () => taskMocks);

import { createCleanupSubtreeCommand } from "../../../../src/commands/cleanup/subtree";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runSubtree = async (args: string[]): Promise<void> => {
  const command = createCleanupSubtreeCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCleanupSubtreeCommand — command tree", () => {
  const subtree = createCleanupSubtreeCommand();

  it("registers the delete subcommand", () => {
    expect(sub(subtree, "delete")).toBeDefined();
  });

  it("marks --path as required on delete", () => {
    const del = sub(subtree, "delete")!;
    const required = del.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--path"]);
  });

  it("declares --scan-root / --orphan-external-refs / --max-deletions / --index / --fields", () => {
    const del = sub(subtree, "delete")!;
    const longs = new Set(del.options.map((o) => o.long));
    for (const long of [
      "--scan-root",
      "--orphan-external-refs",
      "--max-deletions",
      "--index",
      "--fields",
      "--apply",
      "--what-if",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });
});

describe("cleanup subtree delete", () => {
  it("rejects a missing required --path", async () => {
    await expect(runSubtree(["delete", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runCleanupSubtree).not.toHaveBeenCalled();
  });

  it("dry-runs (whatIf coerced true) without --apply and defaults --fields to an empty array", async () => {
    await runSubtree(["delete", "--path", "/sitecore/content/Old", "--quiet"]);
    expect(taskMocks.runCleanupSubtree).toHaveBeenCalledOnce();
    const call = taskMocks.runCleanupSubtree.mock.calls[0][0];
    expect(call.whatIf).toBe(true);
    expect(call.path).toBe("/sitecore/content/Old");
    expect(call.fields).toEqual([]);
  });

  it("splits comma-separated --fields and accumulates repeats", async () => {
    await runSubtree([
      "delete",
      "--path",
      "/sitecore/content/Old",
      "--fields",
      "Renderings, __Renderings",
      "--fields",
      "Datasource",
      "--quiet",
    ]);
    expect(taskMocks.runCleanupSubtree).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ["Renderings", "__Renderings", "Datasource"] })
    );
  });

  it("coerces --max-deletions to a number and threads --orphan-external-refs / --scan-root / --index under --apply", async () => {
    await runSubtree([
      "delete",
      "--path",
      "/sitecore/content/Old",
      "--scan-root",
      "/sitecore",
      "--orphan-external-refs",
      "prune",
      "--max-deletions",
      "500",
      "--index",
      "custom_index",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupSubtree.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      scanRoot: "/sitecore",
      orphanExternalRefs: "prune",
      maxDeletions: 500,
      index: "custom_index",
      apply: true,
    });
    expect(call.whatIf).toBeUndefined();
  });
});
