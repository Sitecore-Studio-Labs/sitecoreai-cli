import { beforeEach, describe, expect, it, vi } from "vitest";
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

const discoveryMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  resolveCredentialMatrix: vi.fn().mockResolvedValue({
    deploy: false,
    cmClient: false,
    aiSkills: false,
    brief: false,
  }),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: discoveryMocks.readRootConfiguration,
}));
vi.mock("../../../../src/shared/credential-matrix", () => ({
  resolveCredentialMatrix: discoveryMocks.resolveCredentialMatrix,
}));

beforeEach(() => {
  // Default: config unreadable — exercises the cold-start degrade path.
  discoveryMocks.readRootConfiguration.mockReset();
  discoveryMocks.readRootConfiguration.mockImplementation(() => {
    throw new Error("no config");
  });
});

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
  it("scai_overview returns the inventory snapshot (degrades when config is unreadable)", async () => {
    const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
    const registry = buildScaiMcpRegistry();
    const tool = registry.getTool("scai_overview")!;
    const result = await tool.handler({}, fakeContext);
    const structured = result.structuredContent as {
      server: { name: string; version: string };
      environment: { name: string };
      environments: unknown[];
      organizations: unknown[];
      toolCount: number;
      resourceUris: string[];
    };
    expect(structured.server.name).toBe("scai");
    expect(structured.environment.name).toBe("test-env");
    expect(structured.toolCount).toBeGreaterThan(0);
    expect(structured.resourceUris).toContain("scai://help/overview");
    // Config threw — discovery degrades to empty lists, no crash.
    expect(structured.environments).toEqual([]);
    expect(structured.organizations).toEqual([]);
  });

  it("scai_overview lists every environment + organization with credential matrices", async () => {
    discoveryMocks.readRootConfiguration.mockReturnValue({
      environments: {
        alpha: { organizationId: "org-1", projectId: "p-a", environmentId: "e-a" },
        beta: { organizationId: "org-1", projectId: "p-b", environmentId: "e-b" },
        gamma: { organizationId: "org-2", projectId: "p-g", environmentId: "e-g" },
      },
      aiSkills: { "org-1": { clientId: "x" } },
    });
    const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
    const registry = buildScaiMcpRegistry();
    const tool = registry.getTool("scai_overview")!;
    const result = await tool.handler({}, { ...fakeContext, envName: "alpha" });
    const structured = result.structuredContent as {
      environments: Array<{ name: string; bound: boolean; organizationId: string }>;
      organizations: Array<{ organizationId: string; environments: string[]; aiSkills: boolean }>;
    };
    expect(structured.environments.map((e) => e.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(structured.environments.find((e) => e.name === "alpha")?.bound).toBe(true);
    expect(structured.environments.find((e) => e.name === "beta")?.bound).toBe(false);
    // org-1 groups alpha + beta; org-2 groups gamma.
    expect(structured.organizations).toEqual([
      { organizationId: "org-1", environments: ["alpha", "beta"], aiSkills: true },
      { organizationId: "org-2", environments: ["gamma"], aiSkills: false },
    ]);
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
