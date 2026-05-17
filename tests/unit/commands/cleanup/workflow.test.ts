import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene cleanup workflow <advance|apply>` command wiring. The
 * workflow-advance / workflow-apply task runners are mocked; tests
 * walk the command tree, assert the required-option enforcement on
 * `--command-name` (advance) and `--workflow` (apply), numeric
 * coercion on the count flags, and the `--apply` dry-run gate.
 */

const taskMocks = vi.hoisted(() => ({
  runCleanupWorkflowAdvance: vi.fn(),
  runCleanupWorkflowApply: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/workflow-advance", () => ({
  runCleanupWorkflowAdvance: taskMocks.runCleanupWorkflowAdvance,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/workflow-apply", () => ({
  runCleanupWorkflowApply: taskMocks.runCleanupWorkflowApply,
}));

import { createCleanupWorkflowCommand } from "../../../../src/commands/cleanup/workflow";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runWorkflow = async (args: string[]): Promise<void> => {
  const command = createCleanupWorkflowCommand();
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

describe("createCleanupWorkflowCommand — command tree", () => {
  const workflow = createCleanupWorkflowCommand();

  it("registers advance and apply", () => {
    expect(sub(workflow, "advance")).toBeDefined();
    expect(sub(workflow, "apply")).toBeDefined();
  });

  it("marks --command-name as required on advance", () => {
    const advance = sub(workflow, "advance")!;
    const required = advance.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--command-name"]);
  });

  it("marks --workflow as required on apply", () => {
    const apply = sub(workflow, "apply")!;
    const required = apply.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--workflow"]);
  });

  it("declares advance-only and apply-only flags on the right verb", () => {
    const advanceLongs = new Set(sub(workflow, "advance")!.options.map((o) => o.long));
    const applyLongs = new Set(sub(workflow, "apply")!.options.map((o) => o.long));
    expect(advanceLongs.has("--from-state")).toBe(true);
    expect(advanceLongs.has("--max-advances")).toBe(true);
    expect(applyLongs.has("--reattach")).toBe(true);
    expect(applyLongs.has("--max-applies")).toBe(true);
    expect(applyLongs.has("--state")).toBe(true);
    expect(applyLongs.has("--template")).toBe(true);
  });
});

describe("cleanup workflow advance", () => {
  it("rejects a missing required --command-name", async () => {
    await expect(runWorkflow(["advance", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runCleanupWorkflowAdvance).not.toHaveBeenCalled();
  });

  it("dry-runs (whatIf coerced true) without --apply", async () => {
    await runWorkflow(["advance", "--command-name", "Submit", "--quiet"]);
    expect(taskMocks.runCleanupWorkflowAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true, commandName: "Submit" })
    );
  });

  it("coerces --stale-days / --max-advances / --limit to numbers and applies with --apply", async () => {
    await runWorkflow([
      "advance",
      "--command-name",
      "Approve",
      "--stale-days",
      "45",
      "--max-advances",
      "50",
      "--limit",
      "2000",
      "--from-state",
      "Draft",
      "--comments",
      "auto-advance",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupWorkflowAdvance.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      commandName: "Approve",
      staleDays: 45,
      maxAdvances: 50,
      limit: 2000,
      fromState: "Draft",
      comments: "auto-advance",
      apply: true,
    });
    expect(call.whatIf).toBeUndefined();
  });
});

describe("cleanup workflow apply", () => {
  it("rejects a missing required --workflow", async () => {
    await expect(runWorkflow(["apply", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runCleanupWorkflowApply).not.toHaveBeenCalled();
  });

  it("dry-runs without --apply and threads --reattach", async () => {
    await runWorkflow(["apply", "--workflow", "Sample Workflow", "--reattach", "--quiet"]);
    expect(taskMocks.runCleanupWorkflowApply).toHaveBeenCalledWith(
      expect.objectContaining({ whatIf: true, workflow: "Sample Workflow", reattach: true })
    );
  });

  it("coerces count flags and threads --state / --template under --apply", async () => {
    await runWorkflow([
      "apply",
      "--workflow",
      "{11111111-1111-1111-1111-111111111111}",
      "--state",
      "Draft",
      "--template",
      "/sitecore/templates/MyTemplate",
      "--stale-days",
      "10",
      "--max-applies",
      "200",
      "--limit",
      "5000",
      "--apply",
      "--quiet",
    ]);
    const call = taskMocks.runCleanupWorkflowApply.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      state: "Draft",
      template: "/sitecore/templates/MyTemplate",
      staleDays: 10,
      maxApplies: 200,
      limit: 5000,
      apply: true,
    });
    expect(call.whatIf).toBeUndefined();
  });
});
