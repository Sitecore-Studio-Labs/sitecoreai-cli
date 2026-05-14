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
  publishItems: vi
    .fn()
    .mockResolvedValue({ id: "pub-1", processedCount: 3, stateName: "Completed" }),
  fetchItemMetadata: vi.fn().mockResolvedValue([
    { id: "{aaa}", path: "/x" },
    { id: "{bbb}", path: "/x/y" },
  ]),
}));

const filterMocks = vi.hoisted(() => ({
  createFieldFilterSet: vi.fn().mockReturnValue({}),
}));

vi.mock("../../../../src/serialization/tasks", () => ({ ...taskMocks }));
vi.mock("../../../../src/serialization/tasks/shared", () => ({ ...sharedMocks }));
vi.mock("../../../../src/serialization/sitecore-api", () => ({ ...apiMocks }));
vi.mock("../../../../src/serialization/field-filter", () => ({ ...filterMocks }));

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

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

describe("serialization tools", () => {
  it("serialization_inspect returns module list from config", async () => {
    const reg = await setup();
    const result = await reg.getTool("serialization_inspect")!.handler({}, fakeContext);
    const structured = result.structuredContent as { modules: Array<{ namespace: string }> };
    expect(structured.modules[0].namespace).toBe("demo");
  });

  it("serialization_sync direction=pull invokes runPull", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_sync")!
      .handler({ direction: "pull", allowWrite: false }, fakeContext);
    expect(taskMocks.runPull).toHaveBeenCalled();
    expect((result.structuredContent as { status: string }).status).toBe("completed");
  });

  it("serialization_sync direction=push requires allowWrite=true (dispatcher-level check)", async () => {
    const reg = await setup();
    const { dispatchTool } = await import("../../../../src/mcp/dispatch");
    const result = await dispatchTool(
      reg.getTool("serialization_sync")!,
      { direction: "push", allowWrite: false },
      { context: fakeContext }
    );
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
  });

  it("serialization_sync direction=push proceeds with allowWrite=true", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_sync")!
      .handler({ direction: "push", allowWrite: true }, fakeContext);
    expect(taskMocks.runPush).toHaveBeenCalled();
    expect((result.structuredContent as { status: string }).status).toBe("completed");
  });

  it("serialization_validate returns valid:true on success", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_validate")!
      .handler({ fix: false }, fakeContext);
    expect((result.structuredContent as { valid: boolean }).valid).toBe(true);
  });

  it("serialization_publish publishes resolved ids", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("serialization_publish")!
      .handler(
        { path: "/sitecore/content/Home", database: "master", allowWrite: true },
        fakeContext
      );
    expect(apiMocks.fetchItemMetadata).toHaveBeenCalled();
    expect(apiMocks.publishItems).toHaveBeenCalledWith(
      fakeContext.resolved.environment,
      ["{aaa}", "{bbb}"],
      undefined
    );
    const structured = result.structuredContent as { itemCount: number; job: { id: string } };
    expect(structured.itemCount).toBe(2);
    expect(structured.job.id).toBe("pub-1");
  });
});
