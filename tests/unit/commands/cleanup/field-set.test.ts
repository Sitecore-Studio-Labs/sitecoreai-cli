import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene cleanup field-set apply` command wiring. Covers the
 * subcommand registration, required + optional flags, --limit /
 * --max-mutations integer coercion, the mode default ('replace'), and
 * the action's whatIf-on-no-apply / apply paths.
 */

const taskMocks = vi.hoisted(() => ({
  runCleanupFieldSet: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/field-set", () => ({
  runCleanupFieldSet: taskMocks.runCleanupFieldSet,
}));

import { createCleanupFieldSetCommand } from "../../../../src/commands/cleanup/field-set";

const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runApply = async (args: string[]): Promise<void> => {
  const command = createCleanupFieldSetCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", "apply", ...args]);
};

beforeEach(() => {
  taskMocks.runCleanupFieldSet.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCleanupFieldSetCommand — command tree", () => {
  const command = createCleanupFieldSetCommand();

  it("registers the apply subcommand", () => {
    expect(sub(command, "apply")).toBeDefined();
  });

  it("marks --field as a required option on apply", () => {
    const apply = sub(command, "apply")!;
    const required = apply.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(expect.arrayContaining(["--field"]));
  });

  it("declares the mode/value/template-pattern/root/language/limit/max-mutations/index/include-system flags on apply", () => {
    const apply = sub(command, "apply")!;
    const longs = new Set(apply.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    for (const long of [
      "--mode",
      "--value",
      "--template-pattern",
      "--where-current-matches",
      "--root",
      "--language",
      "--limit",
      "--max-mutations",
      "--index",
      "--include-system",
      "--include-system-fields",
      "--cache",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("documents the four modes in the after-help text", () => {
    const apply = sub(command, "apply")!;
    let out = "";
    apply.configureOutput({ writeOut: (s) => (out += s) });
    apply.outputHelp();
    expect(out).toContain("replace");
    expect(out).toContain("add");
    expect(out).toContain("remove");
    expect(out).toContain("clear");
  });
});

describe("createCleanupFieldSetCommand — apply action", () => {
  it("defaults mode to 'replace' and forces whatIf when --apply is absent", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runApply(["--field", "Title", "--value", "New", "--quiet"]);
    expect(taskMocks.runCleanupFieldSet).toHaveBeenCalledWith(
      expect.objectContaining({ field: "Title", value: "New", mode: "replace", whatIf: true })
    );
    stderr.mockRestore();
  });

  it("threads --mode add through verbatim", async () => {
    await runApply([
      "--field",
      "Tags",
      "--value",
      "{aaa}|{bbb}",
      "--mode",
      "add",
      "--quiet",
      "--apply",
    ]);
    expect(taskMocks.runCleanupFieldSet).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "add", apply: true })
    );
  });

  it("coerces --limit and --max-mutations to numbers", async () => {
    await runApply([
      "--field",
      "Title",
      "--limit",
      "1000",
      "--max-mutations",
      "50",
      "--quiet",
      "--apply",
    ]);
    expect(taskMocks.runCleanupFieldSet).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1000, maxMutations: 50 })
    );
  });

  it("rejects when --field is missing (commander's required-option error)", async () => {
    await expect(runApply(["--value", "X", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runCleanupFieldSet).not.toHaveBeenCalled();
  });
});
