import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const recipeMocks = vi.hoisted(() => ({
  compileRecipe: vi.fn().mockReturnValue({
    schemaVersion: "1",
    recipeHandle: "demo-comp@1",
    operations: [
      { op: "createItem", index: 0 },
      { op: "setField", index: 1 },
    ],
  }),
  RecipeSchema: { parse: vi.fn((v: unknown) => v) },
}));

const ioMocks = vi.hoisted(() => ({
  loadRecipe: vi.fn().mockResolvedValue({
    kind: "component-template",
    handle: "demo-comp@1",
    meta: { name: "Demo" },
    template: { name: "Demo", section: undefined, fields: [], baseTemplates: [] },
    rendering: { name: "Demo", section: undefined },
  }),
}));

const tasksMocks = vi.hoisted(() => ({
  runRecipePlan: vi.fn().mockResolvedValue({
    schemaVersion: "1",
    recipeHandle: "demo-comp@1",
    actions: [
      { index: 0, operation: { op: "createItem" }, status: "create" },
      { index: 1, operation: { op: "setField" }, status: "skip", reason: "no diff" },
    ],
    summary: { create: 1, update: 0, skip: 1, error: 0 },
  }),
  runRecipeDiff: vi.fn().mockResolvedValue([
    {
      plan: { recipeHandle: "demo-comp@1" },
      summary: { create: 1, update: 0, skip: 0, error: 0 },
      aborted: false,
    },
  ]),
  runRecipePush: vi.fn().mockResolvedValue([
    {
      plan: {
        schemaVersion: "1",
        recipeHandle: "demo-comp@1",
        actions: [],
        summary: { create: 1, update: 0, skip: 0, error: 0 },
      },
      summary: { create: 1, update: 0, skip: 0, error: 0 },
      aborted: false,
    },
  ]),
}));

vi.mock("../../../../src/recipe", () => ({ ...recipeMocks }));
vi.mock("../../../../src/recipe/io", () => ({ ...ioMocks }));
vi.mock("../../../../src/recipe/tasks", () => ({ ...tasksMocks }));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {
      templatesRoot: "/sitecore/templates/Project/site",
      renderingsRoot: "/sitecore/layout/Renderings/Project/site",
    } as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "tok",
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

describe("recipe tools", () => {
  it("recipe_compile reads the file and returns the IR", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("recipe_compile")!
      .handler({ inputPath: "/tmp/demo.recipe.ts" }, fakeContext);
    expect(ioMocks.loadRecipe).toHaveBeenCalledWith("/tmp/demo.recipe.ts");
    expect(recipeMocks.compileRecipe).toHaveBeenCalled();
    const structured = result.structuredContent as { ir: { operations: unknown[] } };
    expect(structured.ir.operations).toHaveLength(2);
  });

  it("recipe_diff returns the diff results", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("recipe_diff")!
      .handler({ inputPath: "/tmp/demo.recipe.ts" }, fakeContext);
    expect(tasksMocks.runRecipeDiff).toHaveBeenCalled();
    const structured = result.structuredContent as { results: unknown[] };
    expect(structured.results).toHaveLength(1);
  });

  it("recipe_plan returns plan summary", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("recipe_plan")!
      .handler({ inputPath: "/tmp/demo.ir.json" }, fakeContext);
    const structured = result.structuredContent as {
      summary: { create: number };
      actions: unknown[];
    };
    expect(structured.summary.create).toBe(1);
    expect(structured.actions).toHaveLength(2);
  });

  it("recipe_push returns the execution result summary", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("recipe_push")!
      .handler({ inputPath: "/tmp/demo.recipe.ts", allowWrite: true }, fakeContext);
    expect(tasksMocks.runRecipePush).toHaveBeenCalled();
    const structured = result.structuredContent as { succeeded: number; failed: number };
    expect(structured.succeeded).toBe(1);
    expect(structured.failed).toBe(0);
  });

  it("recipe_compile rejects when both inputPath and inputRecipe are missing", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const result = await dispatchTool(reg.getTool("recipe_compile")!, {}, { context: fakeContext });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
  });
});
