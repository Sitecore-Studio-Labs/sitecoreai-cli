import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene audit history <capture|list|diff>` command wiring. The
 * history task runners are mocked; tests walk the command tree, then
 * parse it the way the CLI does to assert positional/option threading,
 * the `collectList` accumulator on the comma-separated flags, numeric
 * `--limit` coercion, and the capture-only / diff-only flag placement.
 */

const taskMocks = vi.hoisted(() => ({
  runHistoryCapture: vi.fn(),
  runHistoryList: vi.fn(),
  runHistoryDiff: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/history", () => taskMocks);

import { createAuditHistoryCommand } from "../../../../src/commands/audit/history";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runHistory = async (args: string[]): Promise<void> => {
  const command = createAuditHistoryCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuditHistoryCommand — command tree", () => {
  const history = createAuditHistoryCommand();

  it("registers capture / list / diff", () => {
    for (const name of ["capture", "list", "diff"]) {
      expect(sub(history, name), name).toBeDefined();
    }
  });

  it("declares capture-only flags on capture and not on list", () => {
    const captureLongs = new Set(sub(history, "capture")!.options.map((o) => o.long));
    const listLongs = new Set(sub(history, "list")!.options.map((o) => o.long));
    for (const long of [
      "--root",
      "--limit",
      "--include-system",
      "--include",
      "--exclude-audit",
      "--exclude",
      "--since",
    ]) {
      expect(captureLongs.has(long), long).toBe(true);
    }
    expect(listLongs.has("--root")).toBe(false);
    expect(listLongs.has("--include")).toBe(false);
  });

  it("declares --from / --to on diff only", () => {
    const diffLongs = new Set(sub(history, "diff")!.options.map((o) => o.long));
    const captureLongs = new Set(sub(history, "capture")!.options.map((o) => o.long));
    expect(diffLongs.has("--from")).toBe(true);
    expect(diffLongs.has("--to")).toBe(true);
    expect(captureLongs.has("--from")).toBe(false);
  });
});

describe("audit history capture — option coercion", () => {
  it("defaults the list flags to empty arrays when omitted", async () => {
    await runHistory(["capture", "--quiet"]);
    const call = taskMocks.runHistoryCapture.mock.calls[0][0];
    expect(call.include).toEqual([]);
    expect(call.excludeAudit).toEqual([]);
    expect(call.exclude).toEqual([]);
  });

  it("splits comma-separated --include and accumulates repeats", async () => {
    await runHistory([
      "capture",
      "--include",
      "broken-links, orphans",
      "--include",
      "dead-templates",
      "--quiet",
    ]);
    expect(taskMocks.runHistoryCapture).toHaveBeenCalledWith(
      expect.objectContaining({ include: ["broken-links", "orphans", "dead-templates"] })
    );
  });

  it("coerces --limit to a number and threads --include-system / --root / --since", async () => {
    await runHistory([
      "capture",
      "--limit",
      "500",
      "--include-system",
      "--root",
      "/sitecore/content/Site",
      "--since",
      "2026-01-01",
      "--exclude-audit",
      "duplicates",
      "--exclude",
      "/sitecore/content/Old",
      "--quiet",
    ]);
    expect(taskMocks.runHistoryCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 500,
        includeSystem: true,
        root: "/sitecore/content/Site",
        since: "2026-01-01",
        excludeAudit: ["duplicates"],
        exclude: ["/sitecore/content/Old"],
      })
    );
  });
});

describe("audit history list", () => {
  it("delegates to runHistoryList with the parsed option bag", async () => {
    await runHistory(["list", "--quiet"]);
    expect(taskMocks.runHistoryList).toHaveBeenCalledOnce();
    expect(taskMocks.runHistoryList.mock.calls[0][0]).toMatchObject({ quiet: true });
  });

  it("threads an explicit --environment-name through", async () => {
    await runHistory(["list", "--environment-name", "prod", "--quiet"]);
    expect(taskMocks.runHistoryList).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "prod" })
    );
  });
});

describe("audit history diff", () => {
  it("delegates with no --from / --to (defaults to last two snapshots)", async () => {
    await runHistory(["diff", "--quiet"]);
    expect(taskMocks.runHistoryDiff).toHaveBeenCalledOnce();
    const call = taskMocks.runHistoryDiff.mock.calls[0][0];
    expect(call.from).toBeUndefined();
    expect(call.to).toBeUndefined();
  });

  it("threads explicit --from / --to snapshot paths through", async () => {
    await runHistory([
      "diff",
      "--from",
      ".scai/audit-history/prod/a.json",
      "--to",
      ".scai/audit-history/prod/b.json",
      "--quiet",
    ]);
    expect(taskMocks.runHistoryDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        from: ".scai/audit-history/prod/a.json",
        to: ".scai/audit-history/prod/b.json",
      })
    );
  });
});
