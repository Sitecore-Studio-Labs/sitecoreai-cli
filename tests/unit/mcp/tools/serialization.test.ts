import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const taskMocks = vi.hoisted(() => ({
  runPull: vi.fn().mockResolvedValue(undefined),
  runPush: vi.fn().mockResolvedValue(undefined),
  runDiff: vi.fn().mockResolvedValue(undefined),
  runValidate: vi.fn().mockResolvedValue(undefined),
  runInfo: vi.fn().mockResolvedValue(undefined),
}));

const sharedMocks = vi.hoisted(() => ({
  loadConfigAndModules: vi.fn().mockResolvedValue({
    root: { serialization: { excludedFields: [] } },
    modules: [
      {
        namespace: "demo",
        description: "Demo module",
        sourceIdentifier: "demo.module.json",
        references: [],
        items: {
          includes: [
            {
              name: "demo-subtree",
              database: "master",
              path: { toPathString: () => "/sitecore/templates/Demo" },
              scope: "ItemAndDescendants",
              physicalPath: "/tmp/demo",
              allowedPushOperations: "All",
            },
          ],
        },
        roles: [],
        users: [],
      },
    ],
  }),
}));

const apiMocks = vi.hoisted(() => ({
  publishItemSubtree: vi.fn().mockResolvedValue({
    path: "/sitecore/content/Home",
    database: "master",
    target: undefined,
    itemCount: 2,
    job: { id: "pub-1", processedCount: 2, stateName: "Completed" },
  }),
  fetchItemMetadata: vi.fn().mockResolvedValue([
    { id: "{aaa}", path: "/x" },
    { id: "{bbb}", path: "/x/y" },
  ]),
}));

const filterMocks = vi.hoisted(() => ({
  createFieldFilterSet: vi.fn().mockReturnValue({}),
}));

vi.mock("../../../../src/serialization/tasks/pull", () => ({ runPull: taskMocks.runPull }));
vi.mock("../../../../src/serialization/tasks/push", () => ({ runPush: taskMocks.runPush }));
vi.mock("../../../../src/serialization/tasks/diff", () => ({ runDiff: taskMocks.runDiff }));
vi.mock("../../../../src/serialization/tasks/validate", () => ({
  runValidate: taskMocks.runValidate,
}));
vi.mock("../../../../src/serialization/tasks/info", () => ({ runInfo: taskMocks.runInfo }));
vi.mock("../../../../src/serialization/tasks/shared", () => ({ ...sharedMocks }));
vi.mock("../../../../src/serialization/api/publish", () => ({
  publishItemSubtree: apiMocks.publishItemSubtree,
}));
vi.mock("../../../../src/serialization/api/items", () => ({
  fetchItemMetadata: apiMocks.fetchItemMetadata,
}));
vi.mock("../../../../src/serialization/field-filter", () => ({ ...filterMocks }));

// The push-verb branch now calls `readRootConfiguration` to enforce
// per-env denyMcpElevation; mock to a benign root so the gate passes.
vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: vi.fn(() => ({ environments: { "test-env": {} } })),
}));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: { environmentId: "e-1", host: "https://e.test" } as never,
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

describe("serialization tools", () => {
  it("serialization_inspect returns module list from config", async () => {
    const reg = await setup();
    const result = await reg.getTool("serialization_inspect")!.handler({}, fakeContext, fakeExtra);
    const structured = result.structuredContent as { modules: Array<{ namespace: string }> };
    expect(structured.modules[0].namespace).toBe("demo");
  });

  it("serialization_sync direction=pull invokes runPull", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_sync")!
      .handler({ direction: "pull", allowWrite: false }, fakeContext, fakeExtra);
    expect(taskMocks.runPull).toHaveBeenCalled();
    expect((result.structuredContent as { status: string }).status).toBe("completed");
  });

  it("serialization_sync direction=push requires allowWrite=true (dispatcher-level check)", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const result = await dispatchTool(
      reg.getTool("serialization_sync")!,
      { direction: "push", allowWrite: false },
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

  it("serialization_sync direction=push proceeds with allowWrite=true", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_sync")!
      .handler({ direction: "push", allowWrite: true }, fakeContext, fakeExtra);
    expect(taskMocks.runPush).toHaveBeenCalled();
    expect((result.structuredContent as { status: string }).status).toBe("completed");
  });

  it("serialization_validate returns valid:true on success", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_validate")!
      .handler({ fix: false }, fakeContext, fakeExtra);
    expect((result.structuredContent as { valid: boolean }).valid).toBe(true);
  });

  it("serialization_sync forwards per-database progress events", async () => {
    // Override runPull to synchronously emit database-* events.
    taskMocks.runPull.mockImplementationOnce(
      async (options: {
        emit?: (e: {
          kind: string;
          database: string;
          subtreeCount?: number;
          changes?: number;
          whatIf?: boolean;
        }) => void;
      }) => {
        options.emit?.({ kind: "database-start", database: "master", subtreeCount: 3 });
        options.emit?.({ kind: "database-changes-detected", database: "master", changes: 12 });
        options.emit?.({
          kind: "database-applied",
          database: "master",
          changes: 12,
          whatIf: false,
        });
      }
    );
    const progressMessages: string[] = [];
    const captureExtra = {
      signal: new AbortController().signal,
      progressToken: "tok-2" as string | number | undefined,
      sendProgress: async (_progress: number, _total: number | undefined, message?: string) => {
        if (message) progressMessages.push(message);
      },
      sendNotification: async () => undefined,
    };
    const reg = await setup();
    await reg
      .getTool("serialization_sync")!
      .handler({ direction: "pull", allowWrite: false }, fakeContext, captureExtra);
    expect(progressMessages.some((m) => m.includes("Starting master"))).toBe(true);
    expect(progressMessages.some((m) => m.includes("12 change"))).toBe(true);
  });

  it("serialization_publish delegates to publishItemSubtree", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_publish")!
      .handler(
        { path: "/sitecore/content/Home", database: "master", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(apiMocks.publishItemSubtree).toHaveBeenCalledWith(
      fakeContext.resolved.environment,
      "/sitecore/content/Home",
      { database: "master", target: undefined }
    );
    const structured = result.structuredContent as { itemCount: number; job: { id: string } };
    expect(structured.itemCount).toBe(2);
    expect(structured.job.id).toBe("pub-1");
  });
});
