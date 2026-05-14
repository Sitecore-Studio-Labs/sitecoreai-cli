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

const fakeExtra = {
  signal: new AbortController().signal,
  progressToken: undefined,
  sendProgress: async () => undefined,
  sendNotification: async () => undefined,
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
      .handler({ inputPath: "/tmp/demo.recipe.ts" }, fakeContext, fakeExtra);
    expect(ioMocks.loadRecipe).toHaveBeenCalledWith("/tmp/demo.recipe.ts");
    expect(recipeMocks.compileRecipe).toHaveBeenCalled();
    const structured = result.structuredContent as { ir: { operations: unknown[] } };
    expect(structured.ir.operations).toHaveLength(2);
  });

  it("recipe_diff returns the diff results", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("recipe_diff")!
      .handler({ inputPath: "/tmp/demo.recipe.ts" }, fakeContext, fakeExtra);
    expect(tasksMocks.runRecipeDiff).toHaveBeenCalled();
    const structured = result.structuredContent as { results: unknown[] };
    expect(structured.results).toHaveLength(1);
  });

  it("recipe_plan returns plan summary", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("recipe_plan")!
      .handler({ inputPath: "/tmp/demo.ir.json" }, fakeContext, fakeExtra);
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
      .handler({ inputPath: "/tmp/demo.recipe.ts", allowWrite: true }, fakeContext, fakeExtra);
    expect(tasksMocks.runRecipePush).toHaveBeenCalled();
    const structured = result.structuredContent as { succeeded: number; failed: number };
    expect(structured.succeeded).toBe(1);
    expect(structured.failed).toBe(0);
  });

  it("recipe_push forwards executeIr events as MCP progress notifications", async () => {
    // Re-stub runRecipePush so it synchronously emits events via the
    // option callback before resolving — that's how the live executor
    // surfaces progress.
    tasksMocks.runRecipePush.mockImplementationOnce(
      async (options: {
        emit?: (e: {
          recipe: string;
          event: { kind: string; index?: number; operation?: { op: string } };
        }) => void;
      }): Promise<unknown[]> => {
        options.emit?.({
          recipe: "demo-comp@1",
          event: { kind: "op-start", index: 0, operation: { op: "createItem" } },
        });
        options.emit?.({
          recipe: "demo-comp@1",
          event: {
            kind: "apply-success",
            action: { index: 0, status: "create", operation: { op: "createItem" } },
          } as never,
        });
        return [
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
        ];
      }
    );

    const progressCalls: Array<{ progress: number; message?: string }> = [];
    const captureExtra = {
      signal: new AbortController().signal,
      progressToken: "tok-1" as string | number | undefined,
      sendProgress: async (progress: number, _total: number | undefined, message?: string) => {
        progressCalls.push({ progress, message });
      },
      sendNotification: async () => undefined,
    };

    const reg = await setup();
    await reg
      .getTool("recipe_push")!
      .handler({ inputPath: "/tmp/demo.recipe.ts", allowWrite: true }, fakeContext, captureExtra);

    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(progressCalls[0].message).toContain("demo-comp@1");
    expect(progressCalls[0].message).toContain("createItem");
  });

  it("recipe_compile rejects when both inputPath and inputRecipe are missing", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const result = await dispatchTool(
      reg.getTool("recipe_compile")!,
      {},
      {
        context: fakeContext,
        extra: {
          signal: new AbortController().signal,
          progressToken: undefined,
          sendProgress: async () => undefined,
          sendNotification: async () => undefined,
        },
      }
    );
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
  });
});
