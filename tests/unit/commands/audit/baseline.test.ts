import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene audit baseline …` command wiring. The baseline task
 * runners are mocked; tests walk the command tree, then parse it the
 * way the CLI does to assert positional/option threading, the
 * `collectList` accumulator on `--audits`, numeric `--limit` coercion,
 * and the `requiredOption` enforcement on `remove` / `accept`.
 */

const baselineMocks = vi.hoisted(() => ({
  runBaselineAccept: vi.fn(),
  runBaselineCreate: vi.fn(),
  runBaselineRemove: vi.fn(),
  runBaselineReset: vi.fn(),
  runBaselineShow: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/baseline", () => baselineMocks);

import { createAuditBaselineCommand } from "../../../../src/commands/audit/baseline";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runBaseline = async (args: string[]): Promise<void> => {
  const command = createAuditBaselineCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(baselineMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuditBaselineCommand — command tree", () => {
  const baseline = createAuditBaselineCommand();

  it("registers show / create / remove / reset / accept", () => {
    for (const name of ["show", "create", "remove", "reset", "accept"]) {
      expect(sub(baseline, name), name).toBeDefined();
    }
  });

  it("declares --audits / --reset / --root / --limit / --include-system on create", () => {
    const create = sub(baseline, "create")!;
    const opts = new Set(create.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    for (const long of ["--audits", "--reset", "--root", "--limit", "--include-system"]) {
      expect(opts.has(long), long).toBe(true);
    }
  });

  it("marks --audit + --fingerprint as required on remove", () => {
    const remove = sub(baseline, "remove")!;
    const required = remove.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(expect.arrayContaining(["--audit", "--fingerprint"]));
  });

  it("marks --audit as required on accept and keeps --note / --from-stdin optional", () => {
    const accept = sub(baseline, "accept")!;
    const required = accept.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--audit"]);
    const optional = accept.options.filter((o) => !o.mandatory).map((o) => o.long);
    expect(optional).toEqual(expect.arrayContaining(["--note", "--from-stdin"]));
  });
});

describe("baseline show", () => {
  it("delegates to runBaselineShow with the parsed option bag", async () => {
    await runBaseline(["show", "--quiet"]);
    expect(baselineMocks.runBaselineShow).toHaveBeenCalledOnce();
    expect(baselineMocks.runBaselineShow.mock.calls[0][0]).toMatchObject({ quiet: true });
  });

  it("threads an explicit --environment-name through", async () => {
    await runBaseline(["show", "--environment-name", "prod", "--quiet"]);
    expect(baselineMocks.runBaselineShow).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "prod" })
    );
  });
});

describe("baseline create — option coercion", () => {
  it("defaults --audits to an empty array when omitted", async () => {
    await runBaseline(["create", "--quiet"]);
    expect(baselineMocks.runBaselineCreate.mock.calls[0][0].audits).toEqual([]);
  });

  it("splits a comma-separated --audits value and accumulates repeats", async () => {
    await runBaseline([
      "create",
      "--audits",
      "broken-links, orphans",
      "--audits",
      "dead-templates",
      "--quiet",
    ]);
    expect(baselineMocks.runBaselineCreate).toHaveBeenCalledWith(
      expect.objectContaining({ audits: ["broken-links", "orphans", "dead-templates"] })
    );
  });

  it("coerces --limit to a number and threads --reset / --include-system as booleans", async () => {
    await runBaseline([
      "create",
      "--limit",
      "250",
      "--reset",
      "--include-system",
      "--root",
      "/sitecore/content/Site",
      "--quiet",
    ]);
    expect(baselineMocks.runBaselineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 250,
        reset: true,
        includeSystem: true,
        root: "/sitecore/content/Site",
      })
    );
  });
});

describe("baseline remove", () => {
  it("threads required --audit + --fingerprint into runBaselineRemove", async () => {
    await runBaseline([
      "remove",
      "--audit",
      "broken-links",
      "--fingerprint",
      "deadbeef",
      "--quiet",
    ]);
    expect(baselineMocks.runBaselineRemove).toHaveBeenCalledWith(
      expect.objectContaining({ audit: "broken-links", fingerprint: "deadbeef" })
    );
  });

  it("rejects a missing required --fingerprint", async () => {
    await expect(
      runBaseline(["remove", "--audit", "broken-links", "--quiet"])
    ).rejects.toBeDefined();
    expect(baselineMocks.runBaselineRemove).not.toHaveBeenCalled();
  });
});

describe("baseline reset", () => {
  it("delegates with no --audit (resets all audits)", async () => {
    await runBaseline(["reset", "--quiet"]);
    expect(baselineMocks.runBaselineReset).toHaveBeenCalledOnce();
    expect(baselineMocks.runBaselineReset.mock.calls[0][0].audit).toBeUndefined();
  });

  it("threads an explicit --audit name through", async () => {
    await runBaseline(["reset", "--audit", "orphans", "--quiet"]);
    expect(baselineMocks.runBaselineReset).toHaveBeenCalledWith(
      expect.objectContaining({ audit: "orphans" })
    );
  });
});

describe("baseline accept", () => {
  it("threads --audit / --note / --from-stdin into runBaselineAccept", async () => {
    await runBaseline([
      "accept",
      "--audit",
      "broken-links",
      "--note",
      "known debt",
      "--from-stdin",
      "--quiet",
    ]);
    expect(baselineMocks.runBaselineAccept).toHaveBeenCalledWith(
      expect.objectContaining({ audit: "broken-links", note: "known debt", fromStdin: true })
    );
  });

  it("rejects a missing required --audit", async () => {
    await expect(runBaseline(["accept", "--from-stdin", "--quiet"])).rejects.toBeDefined();
    expect(baselineMocks.runBaselineAccept).not.toHaveBeenCalled();
  });
});
