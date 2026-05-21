import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the `scai provision recipe plan` task runner
 * (`src/recipe/tasks/plan.ts`). The runner loads a pre-compiled IR file,
 * runs the planner against a resolved tenant, writes the plan artifact,
 * and renders either a JSON envelope or a human per-action summary.
 *
 * The dependency modules (`../io`, `../plan`, `./shared`) are mocked —
 * the runner's own branching (input-required guard, output-path default,
 * JSON vs human output, action-tag formatting) is what's under test.
 */

vi.mock("../../../../src/recipe/tasks/shared", () => ({
  toLogger: vi.fn(),
  resolveTenant: vi.fn(),
}));
vi.mock("../../../../src/recipe/io", () => ({
  loadIr: vi.fn(),
  writePlan: vi.fn(),
  defaultPlanPath: vi.fn(),
}));
vi.mock("../../../../src/recipe/runtime/plan", () => ({
  buildPlan: vi.fn(),
}));

import { runRecipePlan } from "../../../../src/recipe/tasks/plan";
import * as shared from "../../../../src/recipe/tasks/shared";
import * as io from "../../../../src/recipe/io";
import { buildPlan } from "../../../../src/recipe/runtime/plan";

interface FakeLogger {
  isJson: () => boolean;
  info: ReturnType<typeof vi.fn>;
}

let logger: FakeLogger;
let jsonMode: boolean;

const makeIr = (recipeHandle = "hero@1") =>
  ({ schemaVersion: "1", recipeHandle, operations: [] }) as never;

/** A plan with one action of each status, plus a summary. */
const makePlan = (overrides: Record<string, unknown> = {}) =>
  ({
    schemaVersion: "1",
    recipeHandle: "hero@1",
    actions: [
      {
        index: 0,
        status: "create",
        operation: { op: "CreateItem", label: "Create Hero" },
      },
      {
        index: 1,
        status: "update",
        operation: { op: "SetField", label: "Set Title" },
        reason: "field drifted",
      },
      {
        index: 2,
        status: "skip",
        operation: { op: "SetField", label: "Skip Body" },
      },
      {
        index: 3,
        status: "error",
        operation: { op: "SetField", label: "Broken Op" },
        reason: "ref not captured",
      },
    ],
    summary: { create: 1, update: 1, skip: 1, error: 1 },
    ...overrides,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  jsonMode = false;
  logger = {
    isJson: () => jsonMode,
    info: vi.fn(),
  };
  vi.mocked(shared.toLogger).mockReturnValue(logger as never);
  vi.mocked(shared.resolveTenant).mockReturnValue({
    envName: "sandbox",
    client: { kind: "authoring-client" },
  } as never);
  vi.mocked(io.loadIr).mockResolvedValue(makeIr());
  vi.mocked(io.defaultPlanPath).mockReturnValue("/tmp/proj/hero.plan.json");
  vi.mocked(io.writePlan).mockResolvedValue(undefined as never);
  vi.mocked(buildPlan).mockResolvedValue(makePlan());
});

describe("runRecipePlan — input guard", () => {
  it("throws INPUT_INVALID when --input is not provided", async () => {
    await expect(runRecipePlan({} as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    // The planner is never reached.
    expect(buildPlan).not.toHaveBeenCalled();
  });

  it("loads the IR file given by --input and plans against the resolved tenant", async () => {
    await runRecipePlan({ input: "/tmp/proj/hero.ir.json" } as never);

    expect(io.loadIr).toHaveBeenCalledWith("/tmp/proj/hero.ir.json");
    expect(buildPlan).toHaveBeenCalledWith(makeIr(), { kind: "authoring-client" });
  });
});

describe("runRecipePlan — output path resolution", () => {
  it("defaults the output path off the recipe handle and input directory", async () => {
    await runRecipePlan({ input: "/tmp/proj/hero.ir.json" } as never);

    expect(io.defaultPlanPath).toHaveBeenCalledWith("hero@1", "/tmp/proj");
    expect(io.writePlan).toHaveBeenCalledWith("/tmp/proj/hero.plan.json", makePlan());
  });

  it("honors an explicit --output path over the default", async () => {
    await runRecipePlan({
      input: "/tmp/proj/hero.ir.json",
      output: "/custom/out.plan.json",
    } as never);

    expect(io.defaultPlanPath).not.toHaveBeenCalled();
    expect(io.writePlan).toHaveBeenCalledWith("/custom/out.plan.json", makePlan());
  });
});

describe("runRecipePlan — JSON envelope", () => {
  it("emits a recipe.plan envelope and returns the plan in --json mode", async () => {
    jsonMode = true;
    const jsonLogger = { ...logger, json: vi.fn() };
    vi.mocked(shared.toLogger).mockReturnValue(jsonLogger as never);

    const plan = await runRecipePlan({ input: "/tmp/proj/hero.ir.json" } as never);

    expect(jsonLogger.json).toHaveBeenCalledTimes(1);
    const envelope = jsonLogger.json.mock.calls[0][0] as Record<string, unknown>;
    expect(envelope).toMatchObject({
      command: "recipe.plan",
      environment: "sandbox",
      recipeHandle: "hero@1",
      input: "/tmp/proj/hero.ir.json",
      output: "/tmp/proj/hero.plan.json",
    });
    // Every action is projected into the envelope with its op + status.
    expect((envelope.actions as unknown[]).length).toBe(4);
    expect(plan.summary).toEqual({ create: 1, update: 1, skip: 1, error: 1 });
  });

  it("projects each action's op, label, status, reason, and diff into the envelope", async () => {
    jsonMode = true;
    const jsonLogger = { ...logger, json: vi.fn() };
    vi.mocked(shared.toLogger).mockReturnValue(jsonLogger as never);

    await runRecipePlan({ input: "/tmp/proj/hero.ir.json" } as never);

    const envelope = jsonLogger.json.mock.calls[0][0] as Record<string, unknown>;
    const actions = envelope.actions as Array<Record<string, unknown>>;
    expect(actions[0]).toMatchObject({ op: "CreateItem", status: "create" });
    expect(actions[1]).toMatchObject({ status: "update", reason: "field drifted" });
    expect(actions[3]).toMatchObject({ status: "error", reason: "ref not captured" });
  });
});

describe("runRecipePlan — human output", () => {
  it("renders one tagged line per action and a summary line", async () => {
    await runRecipePlan({ input: "/tmp/proj/hero.ir.json" } as never);

    const lines = logger.info.mock.calls.map((c) => String(c[0]));
    // Each status maps to a distinct tag.
    expect(lines.some((l) => l.includes("[+] Create Hero"))).toBe(true);
    expect(lines.some((l) => l.includes("[~] Set Title — field drifted"))).toBe(true);
    expect(lines.some((l) => l.includes("[ ] Skip Body"))).toBe(true);
    expect(lines.some((l) => l.includes("[!] Broken Op — ref not captured"))).toBe(true);
    expect(lines.some((l) => l.includes("1 create / 1 update / 1 skip / 1 error"))).toBe(true);
    expect(lines.some((l) => l.includes("Plan written to /tmp/proj/hero.plan.json"))).toBe(true);
  });

  it("omits the error count from the summary when there are no errors", async () => {
    vi.mocked(buildPlan).mockResolvedValue(
      makePlan({
        actions: [
          { index: 0, status: "create", operation: { op: "CreateItem", label: "Create Hero" } },
        ],
        summary: { create: 1, update: 0, skip: 0, error: 0 },
      })
    );

    await runRecipePlan({ input: "/tmp/proj/hero.ir.json" } as never);

    const lines = logger.info.mock.calls.map((c) => String(c[0]));
    const summaryLine = lines.find((l) => l.includes("create /"))!;
    expect(summaryLine).toContain("1 create / 0 update / 0 skip");
    expect(summaryLine).not.toContain("error");
  });

  it("returns the plan object from the human-output path", async () => {
    const plan = await runRecipePlan({ input: "/tmp/proj/hero.ir.json" } as never);
    expect(plan.recipeHandle).toBe("hero@1");
    expect(plan.actions).toHaveLength(4);
  });
});
