import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene audit site-residue list` command wiring. The
 * site-residue task runner is mocked; tests walk the command tree,
 * assert the comma-separated `--root` accumulator, the `--content-root`
 * override, numeric coercion on the audit base flags, and the action
 * delegation.
 */

const taskMocks = vi.hoisted(() => ({
  runAuditSiteResidue: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/site-residue", () => taskMocks);

import { createAuditSiteResidueCommand } from "../../../../src/commands/audit/site-residue";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runSiteResidue = async (args: string[]): Promise<void> => {
  const command = createAuditSiteResidueCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuditSiteResidueCommand — command tree", () => {
  const siteResidue = createAuditSiteResidueCommand();

  it("registers the list subcommand", () => {
    expect(sub(siteResidue, "list")).toBeDefined();
  });

  it("declares --root / --content-root plus the audit base flags", () => {
    const list = sub(siteResidue, "list")!;
    const longs = new Set(list.options.map((o) => o.long));
    for (const long of ["--root", "--content-root", "--include-system", "--limit", "--format"]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("marks no option as required on list", () => {
    const list = sub(siteResidue, "list")!;
    expect(list.options.filter((o) => o.mandatory)).toEqual([]);
  });
});

describe("audit site-residue list", () => {
  it("defaults --root to an empty array when omitted", async () => {
    await runSiteResidue(["list", "--quiet"]);
    expect(taskMocks.runAuditSiteResidue).toHaveBeenCalledOnce();
    expect(taskMocks.runAuditSiteResidue.mock.calls[0][0].root).toEqual([]);
  });

  it("splits comma-separated --root and accumulates repeats", async () => {
    await runSiteResidue([
      "list",
      "--root",
      "/sitecore/templates, /sitecore/layout",
      "--root",
      "/sitecore/media library",
      "--quiet",
    ]);
    expect(taskMocks.runAuditSiteResidue).toHaveBeenCalledWith(
      expect.objectContaining({
        root: ["/sitecore/templates", "/sitecore/layout", "/sitecore/media library"],
      })
    );
  });

  it("threads --content-root override and coerces --limit to a number", async () => {
    await runSiteResidue([
      "list",
      "--content-root",
      "/sitecore/content/Custom",
      "--limit",
      "200",
      "--quiet",
    ]);
    expect(taskMocks.runAuditSiteResidue).toHaveBeenCalledWith(
      expect.objectContaining({ contentRoot: "/sitecore/content/Custom", limit: 200 })
    );
  });

  it("threads --format and --environment-name through", async () => {
    await runSiteResidue(["list", "--format", "json", "--environment-name", "prod", "--quiet"]);
    expect(taskMocks.runAuditSiteResidue).toHaveBeenCalledWith(
      expect.objectContaining({ format: "json", environmentName: "prod" })
    );
  });
});
