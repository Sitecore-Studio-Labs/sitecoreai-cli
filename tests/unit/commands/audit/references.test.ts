import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene audit references list` command wiring. The references
 * task runner is mocked; tests walk the command tree, assert the
 * required-option enforcement on `--to`, the comma-separated `--fields`
 * accumulator, and the `excludeSystemFields` → `includeSystemFields`
 * inversion the action handler applies.
 */

const taskMocks = vi.hoisted(() => ({
  runAuditReferences: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/references", () => taskMocks);

import { createAuditReferencesCommand } from "../../../../src/commands/audit/references";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runReferences = async (args: string[]): Promise<void> => {
  const command = createAuditReferencesCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuditReferencesCommand — command tree", () => {
  const references = createAuditReferencesCommand();

  it("registers the list subcommand", () => {
    expect(sub(references, "list")).toBeDefined();
  });

  it("marks --to as required on list", () => {
    const list = sub(references, "list")!;
    const required = list.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--to"]);
  });

  it("declares --root / --fields / --exclude-system-fields and the audit base flags", () => {
    const list = sub(references, "list")!;
    const longs = new Set(list.options.map((o) => o.long));
    for (const long of ["--root", "--fields", "--exclude-system-fields", "--limit", "--format"]) {
      expect(longs.has(long), long).toBe(true);
    }
  });
});

describe("audit references list", () => {
  it("rejects a missing required --to", async () => {
    await expect(runReferences(["list", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runAuditReferences).not.toHaveBeenCalled();
  });

  it("threads --to and defaults includeSystemFields to true (system fields scanned)", async () => {
    await runReferences(["list", "--to", "{11111111-1111-1111-1111-111111111111}", "--quiet"]);
    expect(taskMocks.runAuditReferences).toHaveBeenCalledOnce();
    const call = taskMocks.runAuditReferences.mock.calls[0][0];
    expect(call.to).toBe("{11111111-1111-1111-1111-111111111111}");
    expect(call.includeSystemFields).toBe(true);
  });

  it("inverts --exclude-system-fields into includeSystemFields:false", async () => {
    await runReferences(["list", "--to", "abc", "--exclude-system-fields", "--quiet"]);
    expect(taskMocks.runAuditReferences).toHaveBeenCalledWith(
      expect.objectContaining({ includeSystemFields: false })
    );
  });

  it("splits comma-separated --fields and accumulates repeats", async () => {
    await runReferences([
      "list",
      "--to",
      "abc",
      "--fields",
      "Renderings, __Renderings",
      "--fields",
      "Datasource",
      "--quiet",
    ]);
    expect(taskMocks.runAuditReferences).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ["Renderings", "__Renderings", "Datasource"] })
    );
  });

  it("coerces --limit / --concurrency to numbers and threads --root", async () => {
    await runReferences([
      "list",
      "--to",
      "abc",
      "--root",
      "/sitecore/content/Site",
      "--limit",
      "750",
      "--concurrency",
      "16",
      "--quiet",
    ]);
    expect(taskMocks.runAuditReferences).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/sitecore/content/Site", limit: 750, concurrency: 16 })
    );
  });
});
