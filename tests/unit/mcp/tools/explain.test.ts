import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

// explain routes to the CLI-shared runExplain* tasks; mock both.
const whyBlockedMock = vi.hoisted(() => ({ runExplainWhyBlocked: vi.fn() }));
const orphanSiteMock = vi.hoisted(() => ({ runExplainOrphanSite: vi.fn() }));
vi.mock("../../../../src/hygiene/tasks/explain/why-blocked", () => whyBlockedMock);
vi.mock("../../../../src/hygiene/tasks/explain/orphan-site", () => orphanSiteMock);

import { McpRegistry } from "../../../../src/mcp/registry";
import { registerExplainTools } from "../../../../src/mcp/tools/explain";

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

const setup = (): McpRegistry => {
  const registry = new McpRegistry();
  registerExplainTools(registry);
  return registry;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("explain tool", () => {
  it("registers explain as a read tool with why-blocked/orphan-site verbs", () => {
    const reg = setup();
    const tool = reg.getTool("explain")!;
    expect(tool).toBeDefined();
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(false);
    const verb = tool.inputSchema.verb as unknown as { options: string[] };
    expect(verb.options).toEqual(["why-blocked", "orphan-site"]);
  });

  it("verb=why-blocked routes to runExplainWhyBlocked with silent set", async () => {
    const reg = setup();
    whyBlockedMock.runExplainWhyBlocked.mockResolvedValue({ itemId: "ABC", blockers: [] });
    const result = await reg
      .getTool("explain")!
      .handler({ verb: "why-blocked", itemId: "ABC" }, fakeContext, fakeExtra);
    expect(whyBlockedMock.runExplainWhyBlocked).toHaveBeenCalledOnce();
    expect(whyBlockedMock.runExplainWhyBlocked.mock.calls[0][0]).toMatchObject({
      itemId: "ABC",
      silent: true,
    });
    expect(result.structuredContent).toMatchObject({ verb: "why-blocked", itemId: "ABC" });
  });

  it("verb=why-blocked without itemId throws", async () => {
    const reg = setup();
    await expect(
      reg.getTool("explain")!.handler({ verb: "why-blocked" }, fakeContext, fakeExtra)
    ).rejects.toThrow(/itemId/);
    expect(whyBlockedMock.runExplainWhyBlocked).not.toHaveBeenCalled();
  });

  it("verb=orphan-site routes to runExplainOrphanSite", async () => {
    const reg = setup();
    orphanSiteMock.runExplainOrphanSite.mockResolvedValue({ site: "marketing", orphans: [] });
    const result = await reg
      .getTool("explain")!
      .handler({ verb: "orphan-site", site: "marketing" }, fakeContext, fakeExtra);
    expect(orphanSiteMock.runExplainOrphanSite).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ verb: "orphan-site", site: "marketing" });
  });

  it("verb=orphan-site without site throws", async () => {
    const reg = setup();
    await expect(
      reg.getTool("explain")!.handler({ verb: "orphan-site" }, fakeContext, fakeExtra)
    ).rejects.toThrow(/site/);
    expect(orphanSiteMock.runExplainOrphanSite).not.toHaveBeenCalled();
  });
});
