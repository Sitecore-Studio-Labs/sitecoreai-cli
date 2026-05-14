import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const apiMocks = vi.hoisted(() => ({
  fetchOrganization: vi
    .fn()
    .mockResolvedValue({ id: "org-1", name: "Acme Org", organizationId: "org-1" }),
  fetchOrganizationHealth: vi.fn().mockResolvedValue({ status: "OK" }),
  fetchOrganizationLicense: vi.fn().mockResolvedValue({ tier: "enterprise" }),
  fetchProjects: vi.fn().mockResolvedValue([{ id: "p-1", name: "site" }]),
  fetchProject: vi.fn().mockResolvedValue({ id: "p-1", name: "site" }),
  fetchProjectEnvironments: vi.fn().mockResolvedValue([{ id: "e-1", name: "dev" }]),
  fetchEnvironments: vi.fn().mockResolvedValue([{ id: "e-1", name: "dev" }]),
  fetchEnvironment: vi.fn().mockResolvedValue({ id: "e-1", name: "dev", cmHost: "https://e.test" }),
  fetchEnvironmentVariables: vi.fn().mockResolvedValue([{ name: "VAR", value: "v" }]),
  fetchEnvironmentDeployments: vi.fn().mockResolvedValue([{ id: "d-1", status: "Complete" }]),
  fetchEnvironmentRestartStatus: vi.fn().mockResolvedValue({ status: "idle" }),
  fetchDeployment: vi.fn().mockResolvedValue({ id: "d-1", status: "Complete" }),
  fetchDeployments: vi.fn().mockResolvedValue([{ id: "d-1", status: "Complete" }]),
  fetchDeploymentLogs: vi.fn().mockResolvedValue({ url: "https://logs.test/d-1" }),
  fetchSourceControlIntegrations: vi.fn().mockResolvedValue([{ id: "i-1" }]),
  fetchSourceControlProviders: vi.fn().mockResolvedValue([{ id: "github" }]),
  fetchSourceControlRepository: vi.fn().mockResolvedValue({ name: "main" }),
  fetchSourceControlTemplates: vi.fn().mockResolvedValue([{ id: "tpl-1" }]),
  fetchSourceControlIntegration: vi.fn().mockResolvedValue({ id: "i-1" }),
  createProject: vi.fn().mockResolvedValue({ id: "p-2" }),
  updateProject: vi.fn().mockResolvedValue({ id: "p-1", updated: true }),
  deleteProject: vi.fn().mockResolvedValue({ deleted: true }),
  createProjectEnvironment: vi.fn().mockResolvedValue({ id: "e-2" }),
  updateEnvironment: vi.fn().mockResolvedValue({ id: "e-1", updated: true }),
  deleteEnvironment: vi.fn().mockResolvedValue({ deleted: true }),
  restartEnvironment: vi.fn().mockResolvedValue({ restartId: "r-1" }),
  promoteEnvironmentDeployment: vi.fn().mockResolvedValue({ promoted: true }),
  regenerateEnvironmentContext: vi.fn().mockResolvedValue({ regenerated: true }),
  linkEnvironmentRepository: vi.fn().mockResolvedValue({ linked: true }),
  unlinkEnvironmentRepository: vi.fn().mockResolvedValue({ unlinked: true }),
  linkProjectRepository: vi.fn().mockResolvedValue({ linked: true }),
  unlinkProjectRepository: vi.fn().mockResolvedValue({ unlinked: true }),
  upsertEnvironmentVariable: vi.fn().mockResolvedValue({ upserted: true }),
  deleteEnvironmentVariable: vi.fn().mockResolvedValue({ deleted: true }),
  createEnvironmentDeployment: vi.fn().mockResolvedValue({ id: "d-2" }),
  deployDeployment: vi.fn().mockResolvedValue({ id: "d-1", redeployed: true }),
  cancelDeployment: vi.fn().mockResolvedValue({ cancelled: true }),
  createSourceControlRepository: vi.fn().mockResolvedValue({ id: "repo-1" }),
  createSourceControlRepositoryGithub: vi.fn().mockResolvedValue({ id: "repo-2" }),
  deleteSourceControlIntegration: vi.fn().mockResolvedValue({ deleted: true }),
  validateSourceControlRepository: vi.fn().mockResolvedValue({ valid: true }),
  probeEnvironmentHealth: vi
    .fn()
    .mockResolvedValue({ host: "h", url: "u", status: 200, ok: true, body: "" }),
  resolveHostFromEnvironment: vi.fn((e: { cmHost?: string }) => e.cmHost),
}));

vi.mock("../../../../src/deploy/api", () => ({ ...apiMocks }));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {
      organizationId: "org-1",
      projectId: "p-1",
      environmentId: "e-1",
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

describe("deploy read tools", () => {
  it("deploy_organization_inspect aggregates org + health + license", async () => {
    const reg = await setup();
    const result = await reg.getTool("deploy_organization_inspect")!.handler({}, fakeContext);
    const structured = result.structuredContent as {
      organization: unknown;
      health: unknown;
      license: unknown;
    };
    expect(structured.organization).toMatchObject({ id: "org-1" });
    expect(structured.health).toBeTruthy();
    expect(structured.license).toBeTruthy();
  });

  it("deploy_project_inspect lists projects with no projectId", async () => {
    const reg = await setup();
    const result = await reg.getTool("deploy_project_inspect")!.handler({ limit: 25 }, fakeContext);
    expect((result.structuredContent as { projects: unknown[] }).projects).toHaveLength(1);
  });

  it("deploy_project_inspect returns detail with projectId", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_project_inspect")!
      .handler({ projectId: "p-1", limit: 25 }, fakeContext);
    const structured = result.structuredContent as {
      project: { id: string };
      environments: unknown[];
    };
    expect(structured.project.id).toBe("p-1");
    expect(structured.environments).toHaveLength(1);
  });

  it("deploy_environment_inspect lists environments with no id", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_inspect")!
      .handler({ limit: 25 }, fakeContext);
    expect((result.structuredContent as { environments: unknown[] }).environments).toHaveLength(1);
  });

  it("deploy_environment_inspect returns detail with environmentId", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_inspect")!
      .handler({ environmentId: "e-1", limit: 25 }, fakeContext);
    const structured = result.structuredContent as {
      environment: { id: string };
      variables: unknown[];
      deployments: unknown[];
    };
    expect(structured.environment.id).toBe("e-1");
    expect(structured.variables).toHaveLength(1);
    expect(structured.deployments).toHaveLength(1);
  });

  it("deploy_run_inspect lists deployments with no id", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_run_inspect")!
      .handler({ limit: 25, includeLogs: false }, fakeContext);
    expect((result.structuredContent as { deployments: unknown[] }).deployments).toHaveLength(1);
  });

  it("deploy_source_control_inspect routes by scope=integrations", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_inspect")!
      .handler({ scope: "integrations" }, fakeContext);
    const structured = result.structuredContent as { scope: string; integrations: unknown[] };
    expect(structured.scope).toBe("integrations");
    expect(structured.integrations).toHaveLength(1);
  });
});

describe("deploy write tools — allowWrite gating", () => {
  it("deploy_project_manage create runs with allowWrite=true", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_project_manage")!
      .handler({ action: "create", name: "new-project", allowWrite: true }, fakeContext);
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { action: string }).action).toBe("create");
  });

  it("deploy_environment_lifecycle restart runs", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_lifecycle")!
      .handler({ action: "restart", environmentId: "e-1", allowWrite: true }, fakeContext);
    expect((result.structuredContent as { action: string }).action).toBe("restart");
  });

  it("deploy_environment_variables upsert", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_variables")!
      .handler(
        { action: "upsert", environmentId: "e-1", name: "VAR", value: "v", allowWrite: true },
        fakeContext
      );
    expect((result.structuredContent as { action: string }).action).toBe("upsert");
  });

  it("deploy_repository_manage scope=environment link", async () => {
    const reg = await setup();
    const result = await reg.getTool("deploy_repository_manage")!.handler(
      {
        scope: "environment",
        action: "link",
        environmentId: "e-1",
        body: { repo: "x" },
        allowWrite: true,
      },
      fakeContext
    );
    expect((result.structuredContent as { scope: string }).scope).toBe("environment");
  });

  it("deploy_run_start creates a deployment", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_run_start")!
      .handler({ environmentId: "e-1", allowWrite: true }, fakeContext);
    expect((result.structuredContent as { mode: string }).mode).toBe("create");
  });

  it("deploy_run_cancel cancels", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_run_cancel")!
      .handler({ deploymentId: "d-1", allowWrite: true }, fakeContext);
    expect(result.isError).toBeUndefined();
  });

  it("deploy_source_control_manage delete-integration", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_manage")!
      .handler(
        { action: "delete-integration", integrationId: "i-1", allowWrite: true },
        fakeContext
      );
    expect((result.structuredContent as { action: string }).action).toBe("delete-integration");
  });
});
