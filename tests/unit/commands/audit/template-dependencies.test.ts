import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene audit template-dependencies list` command wiring. The
 * template-dependencies task runner is mocked; tests walk the command
 * tree, assert the required-option enforcement on `--template-id`, the
 * comma-separated `--skip` accumulator, numeric coercion on the audit
 * base flags, and the action delegation.
 */

const taskMocks = vi.hoisted(() => ({
  runAuditTemplateDependencies: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/template-dependencies", () => taskMocks);

import { createAuditTemplateDependenciesCommand } from "../../../../src/commands/audit/template-dependencies";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runTemplateDeps = async (args: string[]): Promise<void> => {
  const command = createAuditTemplateDependenciesCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuditTemplateDependenciesCommand — command tree", () => {
  const templateDeps = createAuditTemplateDependenciesCommand();

  it("registers the list subcommand", () => {
    expect(sub(templateDeps, "list")).toBeDefined();
  });

  it("marks --template-id as required on list", () => {
    const list = sub(templateDeps, "list")!;
    const required = list.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--template-id"]);
  });

  it("declares --skip plus the audit base flags", () => {
    const list = sub(templateDeps, "list")!;
    const longs = new Set(list.options.map((o) => o.long));
    for (const long of ["--skip", "--include-system", "--limit", "--format", "--concurrency"]) {
      expect(longs.has(long), long).toBe(true);
    }
  });
});

describe("audit template-dependencies list", () => {
  it("rejects a missing required --template-id", async () => {
    await expect(runTemplateDeps(["list", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runAuditTemplateDependencies).not.toHaveBeenCalled();
  });

  it("threads --template-id and defaults --skip to an empty array", async () => {
    await runTemplateDeps([
      "list",
      "--template-id",
      "{22222222-2222-2222-2222-222222222222}",
      "--quiet",
    ]);
    expect(taskMocks.runAuditTemplateDependencies).toHaveBeenCalledOnce();
    const call = taskMocks.runAuditTemplateDependencies.mock.calls[0][0];
    expect(call.templateId).toBe("{22222222-2222-2222-2222-222222222222}");
    expect(call.skip).toEqual([]);
  });

  it("splits comma-separated --skip and accumulates repeats", async () => {
    await runTemplateDeps([
      "list",
      "--template-id",
      "abc",
      "--skip",
      "primary-template, base-template",
      "--skip",
      "insert-options",
      "--quiet",
    ]);
    expect(taskMocks.runAuditTemplateDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: ["primary-template", "base-template", "insert-options"],
      })
    );
  });

  it("coerces --limit / --concurrency to numbers and threads --format", async () => {
    await runTemplateDeps([
      "list",
      "--template-id",
      "abc",
      "--limit",
      "1500",
      "--concurrency",
      "12",
      "--format",
      "csv",
      "--quiet",
    ]);
    expect(taskMocks.runAuditTemplateDependencies).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1500, concurrency: 12, format: "csv" })
    );
  });
});
