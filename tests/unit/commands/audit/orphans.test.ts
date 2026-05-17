import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene audit orphans …` command wiring. The orphans task
 * runner is mocked; tests walk the command tree, then parse it the
 * way the CLI does to assert option threading and numeric coercion
 * on the `--page-size` / `--limit` flags.
 */

const taskMocks = vi.hoisted(() => ({
  runAuditOrphans: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/orphans", () => taskMocks);

import { createAuditOrphansCommand } from "../../../../src/commands/audit/orphans";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runOrphans = async (args: string[]): Promise<void> => {
  const command = createAuditOrphansCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuditOrphansCommand — command tree", () => {
  const orphans = createAuditOrphansCommand();

  it("registers a list subcommand", () => {
    expect(sub(orphans, "list")).toBeDefined();
  });

  it("declares env / config / verbosity and the archive-specific flags on list", () => {
    const list = sub(orphans, "list")!;
    const opts = new Set(list.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    for (const long of [
      "--environment-name",
      "--config",
      "--json",
      "--archive-name",
      "--page-size",
      "--limit",
    ]) {
      expect(opts.has(long), long).toBe(true);
    }
  });
});

describe("orphans list", () => {
  it("delegates to runAuditOrphans with the parsed option bag", async () => {
    await runOrphans(["list", "--quiet"]);
    expect(taskMocks.runAuditOrphans).toHaveBeenCalledOnce();
    expect(taskMocks.runAuditOrphans.mock.calls[0][0]).toMatchObject({ quiet: true });
  });

  it("threads --archive-name and --environment-name through", async () => {
    await runOrphans([
      "list",
      "--quiet",
      "--archive-name",
      "recyclebin",
      "--environment-name",
      "prod",
    ]);
    expect(taskMocks.runAuditOrphans).toHaveBeenCalledWith(
      expect.objectContaining({ archiveName: "recyclebin", environmentName: "prod" })
    );
  });

  it("coerces --page-size and --limit to numbers", async () => {
    await runOrphans(["list", "--quiet", "--page-size", "50", "--limit", "200"]);
    expect(taskMocks.runAuditOrphans).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50, limit: 200 })
    );
  });

  it("leaves --archive-name undefined when omitted (default: all archives)", async () => {
    await runOrphans(["list", "--quiet"]);
    expect(taskMocks.runAuditOrphans.mock.calls[0][0].archiveName).toBeUndefined();
  });
});
