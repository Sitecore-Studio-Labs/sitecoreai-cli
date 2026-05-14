import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const apiMocks = vi.hoisted(() => ({
  fetchEnvironment: vi.fn().mockResolvedValue({
    id: "env-id",
    name: "test-env",
    cmHost: "https://example.test",
  }),
  fetchEnvironmentDeployments: vi.fn().mockResolvedValue([
    { id: "d1", status: "Complete" },
    { id: "d2", status: "Failed" },
  ]),
  probeEnvironmentHealth: vi.fn().mockResolvedValue({
    host: "https://example.test",
    url: "https://example.test/healthz/ready",
    status: 200,
    ok: true,
    body: "OK",
  }),
  resolveHostFromEnvironment: vi.fn((env: { cmHost?: string }) => env.cmHost),
}));

vi.mock("../../../../src/deploy/api", () => ({ ...apiMocks }));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {
      environmentId: "env-id",
      organizationId: "org-id",
      projectId: "proj-id",
    } as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "fake-token",
};

describe("bootstrap tools", () => {
  it("scai_overview returns the inventory snapshot", async () => {
    const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
    const registry = buildScaiMcpRegistry();
    const tool = registry.getTool("scai_overview")!;
    const result = await tool.handler({}, fakeContext);
    const structured = result.structuredContent as {
      server: { name: string; version: string };
      environment: { name: string };
      toolCount: number;
      resourceUris: string[];
    };
    expect(structured.server.name).toBe("scai");
    expect(structured.environment.name).toBe("test-env");
    expect(structured.toolCount).toBeGreaterThan(0);
    expect(structured.resourceUris).toContain("scai://help/overview");
  });

  it("environment_status returns health + recent deployments", async () => {
    const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
    const registry = buildScaiMcpRegistry();
    const tool = registry.getTool("environment_status")!;
    const result = await tool.handler({ includeDeployments: true }, fakeContext);
    const structured = result.structuredContent as {
      environment: { name: string };
      health: { ok: boolean };
      recentDeployments: unknown[];
    };
    expect(structured.environment.name).toBe("test-env");
    expect(structured.health.ok).toBe(true);
    expect(structured.recentDeployments).toHaveLength(2);
  });
});
