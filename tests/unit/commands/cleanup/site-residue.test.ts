import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene cleanup site-residue purge` command wiring. The
 * site-residue cleanup task runner is mocked; tests walk the command
 * tree, assert the comma-separated `--root` accumulator, the
 * `--content-root` / `--index` / `--skip-ref-check` flags, numeric
 * coercion on `--concurrency`, and the `--apply` dry-run gate.
 */

const taskMocks = vi.hoisted(() => ({
  runCleanupSiteResidue: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/site-residue", () => taskMocks);

import { createCleanupSiteResidueCommand } from "../../../../src/commands/cleanup/site-residue";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runSiteResidue = async (args: string[]): Promise<void> => {
  const command = createCleanupSiteResidueCommand();
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

describe("createCleanupSiteResidueCommand — command tree", () => {
  const siteResidue = createCleanupSiteResidueCommand();

  it("registers the purge subcommand", () => {
    expect(sub(siteResidue, "purge")).toBeDefined();
  });

  it("declares --root / --content-root / --skip-ref-check / --index plus cleanup base flags", () => {
    const purge = sub(siteResidue, "purge")!;
    const longs = new Set(purge.options.map((o) => o.long));
    for (const long of [
      "--root",
      "--content-root",
      "--skip-ref-check",
      "--index",
      "--concurrency",
      "--apply",
      "--what-if",
      "--allow-write",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });
});

describe("cleanup site-residue purge", () => {
  it("dry-runs (whatIf coerced true) without --apply and defaults --root to an empty array", async () => {
    await runSiteResidue(["purge", "--quiet"]);
    expect(taskMocks.runCleanupSiteResidue).toHaveBeenCalledOnce();
    const call = taskMocks.runCleanupSiteResidue.mock.calls[0][0];
    expect(call.whatIf).toBe(true);
    expect(call.root).toEqual([]);
  });

  it("splits comma-separated --root and accumulates repeats", async () => {
    await runSiteResidue([
      "purge",
      "--root",
      "/sitecore/templates, /sitecore/layout",
      "--root",
      "/sitecore/media library",
      "--quiet",
    ]);
    expect(taskMocks.runCleanupSiteResidue).toHaveBeenCalledWith(
      expect.objectContaining({
        root: ["/sitecore/templates", "/sitecore/layout", "/sitecore/media library"],
      })
    );
  });

  it("coerces --concurrency to a number and threads --content-root / --index / --skip-ref-check under --apply", async () => {
    await runSiteResidue([
      "purge",
      "--content-root",
      "/sitecore/content/Custom",
      "--index",
      "custom_index",
      "--skip-ref-check",
      "--concurrency",
      "10",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupSiteResidue.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      contentRoot: "/sitecore/content/Custom",
      index: "custom_index",
      skipRefCheck: true,
      concurrency: 10,
      apply: true,
    });
    expect(call.whatIf).toBeUndefined();
  });
});
