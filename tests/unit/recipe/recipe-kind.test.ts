/**
 * Unit tests for the `recipe` recipe kind — the adapter that drives the
 * Sitecore-item recipe compiler through the `sync` engine.
 *
 * The compile → executeIr pipeline is mocked: these tests cover the
 * adapter's own logic (context bridging, the PlannedAction → RecipeChange
 * mapping, the plan→apply payload handoff, and the readCurrent stub), not
 * the compiler/executor it consumes.
 *
 * `vi.mock` factories use RELATIVE paths — the `@/` alias is not resolved
 * by `vi.mock`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../src/sync";
import type { ExecutionResult } from "../../../src/recipe/execute";
import type { OperationIr } from "../../../src/recipe/ir/operations";
import { injectHandleMarker } from "../../../src/recipe/marker";
import type { PlannedAction } from "../../../src/recipe/plan";

// Stub the env → tenant bridge so the kind never touches real config.
const resolveEnvironment = vi.hoisted(() => vi.fn());
vi.mock("../../../src/policy/environment", () => ({ resolveEnvironment }));

// Stub the authoring client factory — the kind only forwards it to executeIr.
const createAuthoringClient = vi.hoisted(() => vi.fn(() => ({ __client: true })));
vi.mock("../../../src/recipe/api/authoring-client", () => ({ createAuthoringClient }));

// Mock the compiler + executor the kind composes.
const compileRecipeSet = vi.hoisted(() => vi.fn());
vi.mock("../../../src/recipe/compile", () => ({ compileRecipeSet }));

const executeIr = vi.hoisted(() => vi.fn());
vi.mock("../../../src/recipe/execute", () => ({ executeIr }));

// Mock the reverse-projection — recipe-kind only resolves roots + delegates.
const readCurrentRecipes = vi.hoisted(() => vi.fn());
vi.mock("../../../src/recipe/read-current", () => ({ readCurrentRecipes }));

import { recipeKind } from "../../../src/recipe/recipe-kind";

const ctx: SyncContext = { environmentName: "test", configPath: "/cfg" };
const ref = { kind: "recipe", id: "set" } as const;

/** Build an `OperationIr` with `n` no-op operations under `handle`. */
const makeIr = (handle: string, n: number): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: handle,
  operations: Array.from({ length: n }, (_, i) => ({
    op: "CreateItem" as const,
    label: `${handle} op ${i}`,
    fields: [],
  })) as OperationIr["operations"],
});

/** Build a `PlannedAction` of a given status. */
const makeAction = (
  index: number,
  status: PlannedAction["status"],
  label: string,
  reason?: string
): PlannedAction => ({
  index,
  operation: { op: "CreateItem", label } as PlannedAction["operation"],
  status,
  ...(reason !== undefined && { reason }),
});

/** Build an `ExecutionResult` from a handle + a list of actions. */
const makeResult = (handle: string, actions: PlannedAction[]): ExecutionResult => ({
  plan: {
    schemaVersion: "1",
    recipeHandle: handle,
    actions,
    summary: { create: 0, update: 0, skip: 0, error: 0 },
  },
  summary: { create: 0, update: 0, skip: 0, error: 0 },
  aborted: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveEnvironment.mockReturnValue({
    envName: "test",
    environment: { templatesRoot: "/t", renderingsRoot: "/r" },
    timeoutMs: undefined,
  });
  createAuthoringClient.mockReturnValue({ __client: true });
});

describe("recipeKind", () => {
  it("exposes the recipe-kind contract", () => {
    expect(recipeKind.name).toBe("recipe");
    expect(recipeKind.schema).toBeDefined();
    expect(typeof recipeKind.readCurrent).toBe("function");
    expect(typeof recipeKind.plan).toBe("function");
    expect(typeof recipeKind.apply).toBe("function");
  });

  it("validates a recipe SET (an array) via its schema", () => {
    // An empty array is a valid (degenerate) recipe set.
    expect(recipeKind.schema.safeParse([]).success).toBe(true);
    // A bare object is not — the schema is `z.array(RecipeSchema)`.
    expect(recipeKind.schema.safeParse({ kind: "component-template" }).success).toBe(false);
  });
});

describe("plan", () => {
  it("compiles the set, executes each IR in plan mode, and maps actions to changes", async () => {
    const irs = [makeIr("a@1", 1), makeIr("b@1", 1)];
    compileRecipeSet.mockReturnValue(irs);
    executeIr
      .mockResolvedValueOnce(makeResult("a@1", [makeAction(0, "create", "create a")]))
      .mockResolvedValueOnce(makeResult("b@1", [makeAction(0, "update", "update b")]));

    const result = await recipeKind.plan([], ref, ctx);

    expect(compileRecipeSet).toHaveBeenCalledOnce();
    // Every executeIr call runs in plan mode (no writes).
    expect(executeIr).toHaveBeenCalledTimes(2);
    for (const call of executeIr.mock.calls) {
      expect(call[2]).toMatchObject({ mode: "plan" });
    }
    expect(result.changes).toEqual([
      { kind: "create", path: "a@1.op[0]", summary: "create a" },
      { kind: "update", path: "b@1.op[0]", summary: "update b" },
    ]);
  });

  it("bridges SyncContext.configPath / environmentName into resolveEnvironment", async () => {
    compileRecipeSet.mockReturnValue([]);
    await recipeKind.plan([], ref, ctx);
    expect(resolveEnvironment).toHaveBeenCalledWith({
      config: "/cfg",
      environmentName: "test",
    });
  });

  it("stashes the compiled IRs in RecipePlan.payload for apply to reuse", async () => {
    const irs = [makeIr("a@1", 1)];
    compileRecipeSet.mockReturnValue(irs);
    executeIr.mockResolvedValue(makeResult("a@1", [makeAction(0, "skip", "skip a")]));

    const result = await recipeKind.plan([], ref, ctx);

    // `plan` stamps the `Scai Handle` marker onto the compiled IRs before
    // stashing them, so the payload carries the marker-injected set.
    expect(result.payload).toEqual({ irs: irs.map(injectHandleMarker) });
  });

  it("maps skip → noop and create/update straight through", async () => {
    compileRecipeSet.mockReturnValue([makeIr("a@1", 3)]);
    executeIr.mockResolvedValue(
      makeResult("a@1", [
        makeAction(0, "create", "c"),
        makeAction(1, "update", "u"),
        makeAction(2, "skip", "s", "already at desired value"),
      ])
    );

    const { changes } = await recipeKind.plan([], ref, ctx);

    expect(changes.map((c) => c.kind)).toEqual(["create", "update", "noop"]);
    // A skip carries its reason in the summary.
    expect(changes[2].summary).toContain("already at desired value");
  });

  it("surfaces an error action as an ERROR-prefixed noop, never silently dropped", async () => {
    compileRecipeSet.mockReturnValue([makeIr("a@1", 1)]);
    executeIr.mockResolvedValue(
      makeResult("a@1", [makeAction(0, "error", "broken op", "template missing on tenant")])
    );

    const { changes } = await recipeKind.plan([], ref, ctx);

    expect(changes).toHaveLength(1);
    const change = changes[0];
    expect(change.kind).toBe("noop");
    expect(change.summary).toMatch(/^ERROR /);
    expect(change.summary).toContain("template missing on tenant");
    expect(change.meta).toMatchObject({
      operation: "CreateItem",
      error: "template missing on tenant",
    });
  });
});

describe("apply", () => {
  it("reads IRs from payload and re-executes them in apply mode", async () => {
    const irs = [makeIr("a@1", 1), makeIr("b@1", 1)];
    executeIr
      .mockResolvedValueOnce(makeResult("a@1", [makeAction(0, "create", "create a")]))
      .mockResolvedValueOnce(makeResult("b@1", [makeAction(0, "skip", "skip b")]));

    const result = await recipeKind.apply({ changes: [], payload: { irs } }, ref, ctx);

    expect(executeIr).toHaveBeenCalledTimes(2);
    for (const call of executeIr.mock.calls) {
      expect(call[2]).toMatchObject({ mode: "apply" });
    }
    // create lands in `applied`, skip (→ noop) lands in `skipped`.
    expect(result.applied.map((c) => c.path)).toEqual(["a@1.op[0]"]);
    expect(result.skipped.map((c) => c.path)).toEqual(["b@1.op[0]"]);
  });

  it("classifies update as applied and error as skipped", async () => {
    const irs = [makeIr("a@1", 2)];
    executeIr.mockResolvedValue(
      makeResult("a@1", [
        makeAction(0, "update", "u"),
        makeAction(1, "error", "e", "server rejected"),
      ])
    );

    const result = await recipeKind.apply({ changes: [], payload: { irs } }, ref, ctx);

    expect(result.applied.map((c) => c.kind)).toEqual(["update"]);
    expect(result.skipped.map((c) => c.kind)).toEqual(["noop"]);
    expect(result.skipped[0].summary).toMatch(/^ERROR /);
  });

  it("does not recompile — apply never calls compileRecipeSet", async () => {
    executeIr.mockResolvedValue(makeResult("a@1", []));
    await recipeKind.apply({ changes: [], payload: { irs: [makeIr("a@1", 0)] } }, ref, ctx);
    expect(compileRecipeSet).not.toHaveBeenCalled();
  });

  it("throws when the plan carries no compiled IRs", async () => {
    await expect(recipeKind.apply({ changes: [] }, ref, ctx)).rejects.toThrow(/no compiled IRs/);
  });
});

describe("readCurrent", () => {
  it("resolves the env roots and delegates to readCurrentRecipes", async () => {
    resolveEnvironment.mockReturnValue({
      envName: "test",
      environment: {
        templatesRoot: "/t",
        renderingsRoot: "/r",
        componentsRoot: "/c",
        contentModelsRoot: "/cm",
        enumerationsRoot: "/e",
      },
      timeoutMs: undefined,
    });
    const pulled = [{ kind: "enumeration" }];
    readCurrentRecipes.mockResolvedValue(pulled);

    const result = await recipeKind.readCurrent(ref, ctx);

    expect(readCurrentRecipes).toHaveBeenCalledOnce();
    const [roots, client] = readCurrentRecipes.mock.calls[0];
    expect(roots).toEqual({
      templatesRoot: "/t",
      renderingsRoot: "/r",
      componentsRoot: "/c",
      contentModelsRoot: "/cm",
      enumerationsRoot: "/e",
    });
    expect(client).toEqual({ __client: true });
    expect(result).toBe(pulled);
  });

  it("forwards a null result (no recipe roots configured)", async () => {
    readCurrentRecipes.mockResolvedValue(null);
    await expect(recipeKind.readCurrent(ref, ctx)).resolves.toBeNull();
  });

  it("omits optional roots the env profile leaves unset", async () => {
    // beforeEach env profile only sets templatesRoot + renderingsRoot.
    readCurrentRecipes.mockResolvedValue([]);
    await recipeKind.readCurrent(ref, ctx);
    expect(readCurrentRecipes.mock.calls[0][0]).toEqual({
      templatesRoot: "/t",
      renderingsRoot: "/r",
    });
  });
});
