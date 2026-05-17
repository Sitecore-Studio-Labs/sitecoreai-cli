import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

const authMocks = vi.hoisted(() => ({
  resolveToolBinding: vi.fn(),
}));

// Partial-mock auth: the tool handlers import `resolveToolBinding`, so
// stubbing it here lets a test choose the bound context or a retargeted
// binding without reaching the real config/keychain. The default
// implementation echoes the bound context (omitted-environmentName
// behavior); retargeting tests override per-call.
vi.mock("../../../../src/mcp/auth", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/mcp/auth")>(
    "../../../../src/mcp/auth"
  );
  return { ...actual, resolveToolBinding: authMocks.resolveToolBinding };
});

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

// Default: handlers see the bound context (the omitted-environmentName
// path). Retargeting tests override `resolveToolBinding` per-call.
beforeEach(() => {
  authMocks.resolveToolBinding.mockReset();
  authMocks.resolveToolBinding.mockImplementation(
    async (ctx: McpContext, environmentName?: string) => {
      if (!environmentName || environmentName === ctx.envName) {
        return ctx;
      }
      throw new Error(`unexpected retarget to '${environmentName}'`);
    }
  );
});

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

describe("deploy write tools — required-input validation", () => {
  it("deploy_project_manage create without name throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_project_manage")!
        .handler({ action: "create", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_project_manage update without projectId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_project_manage")!
        .handler({ action: "update", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_project_manage delete forwards projectId to deleteProject", async () => {
    apiMocks.deleteProject.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_project_manage")!
      .handler({ action: "delete", projectId: "p-1", allowWrite: true }, fakeContext);
    expect(apiMocks.deleteProject).toHaveBeenCalledWith({ accessToken: "tok" }, "p-1");
    expect((result.structuredContent as { action: string }).action).toBe("delete");
  });

  it("deploy_environment_lifecycle create without projectId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_environment_lifecycle")!
        .handler({ action: "create", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_environment_lifecycle promote without deploymentId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_environment_lifecycle")!
        .handler(
          { action: "promote", environmentId: "e-1", allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_environment_lifecycle delete forwards force flag", async () => {
    apiMocks.deleteEnvironment.mockClear();
    const reg = await setup();
    await reg
      .getTool("deploy_environment_lifecycle")!
      .handler(
        { action: "delete", environmentId: "e-1", force: true, allowWrite: true },
        fakeContext
      );
    expect(apiMocks.deleteEnvironment).toHaveBeenCalledWith({ accessToken: "tok" }, "e-1", true);
  });

  it("deploy_environment_variables upsert without value throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_environment_variables")!
        .handler(
          { action: "upsert", environmentId: "e-1", name: "VAR", allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_environment_variables delete routes to deleteEnvironmentVariable", async () => {
    apiMocks.deleteEnvironmentVariable.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_variables")!
      .handler(
        { action: "delete", environmentId: "e-1", name: "VAR", allowWrite: true },
        fakeContext
      );
    expect(apiMocks.deleteEnvironmentVariable).toHaveBeenCalledWith(
      { accessToken: "tok" },
      "e-1",
      "VAR"
    );
    expect((result.structuredContent as { action: string }).action).toBe("delete");
  });

  it("deploy_repository_manage link without body throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_repository_manage")!
        .handler(
          { scope: "environment", action: "link", environmentId: "e-1", allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_repository_manage scope=project unlink routes to unlinkProjectRepository", async () => {
    apiMocks.unlinkProjectRepository.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_repository_manage")!
      .handler(
        { scope: "project", action: "unlink", projectId: "p-1", allowWrite: true },
        fakeContext
      );
    expect(apiMocks.unlinkProjectRepository).toHaveBeenCalledWith({ accessToken: "tok" }, "p-1");
    expect((result.structuredContent as { scope: string }).scope).toBe("project");
  });

  it("deploy_source_control_manage create-repository without body throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_source_control_manage")!
        .handler({ action: "create-repository", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_source_control_manage validate-repository routes correctly", async () => {
    apiMocks.validateSourceControlRepository.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_manage")!
      .handler(
        { action: "validate-repository", body: { repo: "x" }, allowWrite: true },
        fakeContext
      );
    expect(apiMocks.validateSourceControlRepository).toHaveBeenCalled();
    expect((result.structuredContent as { action: string }).action).toBe("validate-repository");
  });

  it("deploy_source_control_manage create-repository routes to createSourceControlRepository", async () => {
    apiMocks.createSourceControlRepository.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_manage")!
      .handler({ action: "create-repository", body: { name: "r" }, allowWrite: true }, fakeContext);
    expect(apiMocks.createSourceControlRepository).toHaveBeenCalledWith(
      { accessToken: "tok" },
      { name: "r" },
      "org-1"
    );
    expect((result.structuredContent as { action: string }).action).toBe("create-repository");
  });

  it("deploy_source_control_manage create-repository-github routes to its GitHub variant", async () => {
    apiMocks.createSourceControlRepositoryGithub.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_manage")!
      .handler(
        { action: "create-repository-github", body: { name: "r" }, allowWrite: true },
        fakeContext
      );
    expect(apiMocks.createSourceControlRepositoryGithub).toHaveBeenCalled();
    expect((result.structuredContent as { action: string }).action).toBe(
      "create-repository-github"
    );
  });

  it("deploy_environment_lifecycle regenerate-context routes to regenerateEnvironmentContext", async () => {
    apiMocks.regenerateEnvironmentContext.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_lifecycle")!
      .handler(
        { action: "regenerate-context", environmentId: "e-1", allowWrite: true },
        fakeContext
      );
    expect(apiMocks.regenerateEnvironmentContext).toHaveBeenCalledWith(
      { accessToken: "tok" },
      "e-1"
    );
    expect((result.structuredContent as { action: string }).action).toBe("regenerate-context");
  });

  it("deploy_environment_lifecycle promote routes to promoteEnvironmentDeployment", async () => {
    apiMocks.promoteEnvironmentDeployment.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_lifecycle")!
      .handler(
        { action: "promote", environmentId: "e-1", deploymentId: "d-1", allowWrite: true },
        fakeContext
      );
    expect(apiMocks.promoteEnvironmentDeployment).toHaveBeenCalledWith(
      { accessToken: "tok" },
      "e-1",
      "d-1"
    );
    expect((result.structuredContent as { action: string }).action).toBe("promote");
  });

  it("deploy_repository_manage scope=project requires projectId", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_repository_manage")!
        .handler({ scope: "project", action: "link", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("deploy read tools — detail + scope branches", () => {
  it("deploy_run_inspect returns detail + logs when deploymentId + includeLogs are set", async () => {
    apiMocks.fetchDeploymentLogs.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_run_inspect")!
      .handler({ deploymentId: "d-1", includeLogs: true, limit: 25 }, fakeContext);
    const structured = result.structuredContent as { deployment: { id: string }; logs: unknown };
    expect(structured.deployment.id).toBe("d-1");
    expect(structured.logs).toBeTruthy();
    expect(apiMocks.fetchDeploymentLogs).toHaveBeenCalledWith("d-1", "tok");
  });

  it("deploy_run_inspect swallows a logs failure and returns logs=null", async () => {
    apiMocks.fetchDeploymentLogs.mockRejectedValueOnce(new Error("403"));
    const reg = await setup();
    const result = await reg
      .getTool("deploy_run_inspect")!
      .handler({ deploymentId: "d-1", includeLogs: true, limit: 25 }, fakeContext);
    expect((result.structuredContent as { logs: unknown }).logs).toBeNull();
  });

  it("deploy_source_control_inspect routes scope=providers", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_inspect")!
      .handler({ scope: "providers" }, fakeContext);
    expect((result.structuredContent as { scope: string }).scope).toBe("providers");
  });

  it("deploy_source_control_inspect returns integration detail when integrationId is given", async () => {
    apiMocks.fetchSourceControlIntegration.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_inspect")!
      .handler({ scope: "integrations", integrationId: "i-1" }, fakeContext);
    expect(apiMocks.fetchSourceControlIntegration).toHaveBeenCalledWith(
      { accessToken: "tok" },
      "i-1"
    );
    expect((result.structuredContent as { integration: unknown }).integration).toBeTruthy();
  });

  it("deploy_run_start with deploymentId redeploys an existing deployment", async () => {
    apiMocks.deployDeployment.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_run_start")!
      .handler({ environmentId: "e-1", deploymentId: "d-1", allowWrite: true }, fakeContext);
    expect(apiMocks.deployDeployment).toHaveBeenCalledWith({ accessToken: "tok" }, "d-1", "org-1");
    expect((result.structuredContent as { mode: string }).mode).toBe("deploy-existing");
  });
});

describe("deploy write tools — additional action branches", () => {
  it("deploy_environment_lifecycle update routes to updateEnvironment", async () => {
    apiMocks.updateEnvironment.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_lifecycle")!
      .handler(
        { action: "update", environmentId: "e-1", body: { name: "renamed" }, allowWrite: true },
        fakeContext
      );
    expect(apiMocks.updateEnvironment).toHaveBeenCalledWith({ accessToken: "tok" }, "e-1", {
      name: "renamed",
    });
    expect((result.structuredContent as { action: string }).action).toBe("update");
  });

  it("deploy_environment_lifecycle update without environmentId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_environment_lifecycle")!
        .handler({ action: "update", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_environment_lifecycle restart without environmentId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_environment_lifecycle")!
        .handler({ action: "restart", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_environment_lifecycle regenerate-context without environmentId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_environment_lifecycle")!
        .handler({ action: "regenerate-context", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_environment_variables upsert threads target + secret into the API call", async () => {
    apiMocks.upsertEnvironmentVariable.mockClear();
    const reg = await setup();
    await reg.getTool("deploy_environment_variables")!.handler(
      {
        action: "upsert",
        environmentId: "e-1",
        name: "API_KEY",
        value: "v",
        target: "EditingHost",
        secret: true,
        allowWrite: true,
      },
      fakeContext
    );
    expect(apiMocks.upsertEnvironmentVariable).toHaveBeenCalledOnce();
  });

  it("deploy_project_manage update routes to updateProject", async () => {
    apiMocks.updateProject.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_project_manage")!
      .handler(
        { action: "update", projectId: "p-1", body: { name: "x" }, allowWrite: true },
        fakeContext
      );
    expect(apiMocks.updateProject).toHaveBeenCalledWith({ accessToken: "tok" }, "p-1", {
      name: "x",
    });
    expect((result.structuredContent as { action: string }).action).toBe("update");
  });
});

describe("deploy read tools — scope branches", () => {
  it("deploy_source_control_inspect routes scope=repository", async () => {
    apiMocks.fetchSourceControlRepository.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_inspect")!
      .handler({ scope: "repository" }, fakeContext);
    expect((result.structuredContent as { scope: string }).scope).toBe("repository");
  });

  it("deploy_source_control_inspect routes scope=templates", async () => {
    apiMocks.fetchSourceControlTemplates.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_source_control_inspect")!
      .handler({ scope: "templates" }, fakeContext);
    expect((result.structuredContent as { scope: string }).scope).toBe("templates");
  });

  it("deploy_environment_inspect with no environmentId derives projectId from the bound env", async () => {
    apiMocks.fetchProjectEnvironments.mockClear();
    apiMocks.fetchEnvironments.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_inspect")!
      .handler({ projectId: "p-1", limit: 25 }, fakeContext);
    expect((result.structuredContent as { environments: unknown[] }).environments).toHaveLength(1);
  });

  it("deploy_run_inspect lists org-wide deployments when the bound env has no environmentId", async () => {
    authMocks.resolveToolBinding.mockResolvedValueOnce({
      envName: "test-env",
      resolved: {
        envName: "test-env",
        // No environmentId → the org-wide fetchDeployments branch.
        environment: { organizationId: "org-1", projectId: "p-1" },
        root: {},
        timeoutMs: undefined,
      },
      allowWriteEnabled: false,
      deployToken: "tok",
    });
    apiMocks.fetchDeployments.mockClear();
    const reg = await setup();
    await reg
      .getTool("deploy_run_inspect")!
      .handler({ limit: 25, includeLogs: false }, fakeContext);
    expect(apiMocks.fetchDeployments).toHaveBeenCalledWith({ accessToken: "tok" });
  });

  it("deploy_run_start with redeploy=true creates a redeploy deployment", async () => {
    apiMocks.createEnvironmentDeployment.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_run_start")!
      .handler({ environmentId: "e-1", redeploy: true, allowWrite: true }, fakeContext);
    expect(apiMocks.createEnvironmentDeployment).toHaveBeenCalledWith(
      { accessToken: "tok" },
      "e-1",
      true
    );
    expect(result.content[0]!.text).toContain("redeploy");
  });
});

describe("deploy tools — per-call environment retargeting", () => {
  const prodBinding = {
    envName: "prod",
    resolved: {
      envName: "prod",
      environment: { organizationId: "org-prod", projectId: "p-prod" },
      root: { environments: {} },
      timeoutMs: undefined,
    },
    allowWriteEnabled: true,
    deployToken: "prod-token",
  };

  it("uses the bound context when environmentName is omitted", async () => {
    apiMocks.fetchOrganization.mockClear();
    const reg = await setup();
    await reg.getTool("deploy_organization_inspect")!.handler({}, fakeContext);
    expect(authMocks.resolveToolBinding).toHaveBeenCalledWith(fakeContext, undefined);
    // Bound token threaded through to the Deploy API client.
    expect(apiMocks.fetchOrganization).toHaveBeenCalledWith({ accessToken: "tok" });
  });

  it("resolves the target env and threads its deploy token when environmentName is set", async () => {
    authMocks.resolveToolBinding.mockResolvedValue(prodBinding);
    apiMocks.fetchOrganization.mockClear();
    const reg = await setup();
    await reg
      .getTool("deploy_organization_inspect")!
      .handler({ environmentName: "prod" }, fakeContext);
    expect(authMocks.resolveToolBinding).toHaveBeenCalledWith(fakeContext, "prod");
    expect(apiMocks.fetchOrganization).toHaveBeenCalledWith({ accessToken: "prod-token" });
  });

  it("derives the target env's organizationId for org-scoped Deploy calls", async () => {
    authMocks.resolveToolBinding.mockResolvedValue(prodBinding);
    apiMocks.cancelDeployment.mockClear();
    const reg = await setup();
    await reg
      .getTool("deploy_run_cancel")!
      .handler({ deploymentId: "d-9", environmentName: "prod", allowWrite: true }, fakeContext);
    expect(apiMocks.cancelDeployment).toHaveBeenCalledWith(
      { accessToken: "prod-token" },
      "d-9",
      "org-prod"
    );
  });

  it("every environment-scoped deploy tool exposes the environmentName input field", async () => {
    const reg = await setup();
    const deployTools = reg.listTools().filter((t) => t.name.startsWith("deploy_"));
    expect(deployTools.length).toBeGreaterThan(0);
    for (const tool of deployTools) {
      expect(Object.keys(tool.inputSchema)).toContain("environmentName");
    }
  });
});

describe("deploy read tools — fallback (.catch) branches", () => {
  it("deploy_organization_inspect skips the license fetch when no organizationId resolves", async () => {
    apiMocks.fetchOrganization.mockResolvedValueOnce({ name: "Acme Org" });
    apiMocks.fetchOrganizationLicense.mockClear();
    const reg = await setup();
    const result = await reg.getTool("deploy_organization_inspect")!.handler({}, fakeContext);
    expect(apiMocks.fetchOrganizationLicense).not.toHaveBeenCalled();
    expect((result.structuredContent as { license: unknown }).license).toBeNull();
  });

  it("deploy_organization_inspect returns health=null when the health probe rejects", async () => {
    apiMocks.fetchOrganizationHealth.mockRejectedValueOnce(new Error("health down"));
    const reg = await setup();
    const result = await reg.getTool("deploy_organization_inspect")!.handler({}, fakeContext);
    expect((result.structuredContent as { health: unknown }).health).toBeNull();
  });

  it("deploy_project_inspect returns environments=[] when the environments fetch rejects", async () => {
    apiMocks.fetchProjectEnvironments.mockRejectedValueOnce(new Error("no envs"));
    const reg = await setup();
    const result = await reg
      .getTool("deploy_project_inspect")!
      .handler({ projectId: "p-1" }, fakeContext);
    expect((result.structuredContent as { environments: unknown[] }).environments).toEqual([]);
  });

  it("deploy_environment_inspect tolerates rejected variable/deployment/restart fetches", async () => {
    apiMocks.fetchEnvironmentVariables.mockRejectedValueOnce(new Error("vars down"));
    apiMocks.fetchEnvironmentDeployments.mockRejectedValueOnce(new Error("deps down"));
    apiMocks.fetchEnvironmentRestartStatus.mockRejectedValueOnce(new Error("restart down"));
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_inspect")!
      .handler({ environmentId: "e-1" }, fakeContext);
    const sc = result.structuredContent as {
      variables: unknown[];
      deployments: unknown[];
      restartStatus: unknown;
    };
    expect(sc.variables).toEqual([]);
    expect(sc.deployments).toEqual([]);
    expect(sc.restartStatus).toBeNull();
  });

  it("deploy_environment_inspect returns health=null when the env exposes no host", async () => {
    apiMocks.resolveHostFromEnvironment.mockReturnValueOnce(undefined);
    apiMocks.probeEnvironmentHealth.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_inspect")!
      .handler({ environmentId: "e-1" }, fakeContext);
    expect(apiMocks.probeEnvironmentHealth).not.toHaveBeenCalled();
    expect((result.structuredContent as { health: unknown }).health).toBeNull();
  });

  it("deploy_environment_inspect returns health=null when the probe rejects", async () => {
    apiMocks.probeEnvironmentHealth.mockRejectedValueOnce(new Error("probe failed"));
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_inspect")!
      .handler({ environmentId: "e-1" }, fakeContext);
    expect((result.structuredContent as { health: unknown }).health).toBeNull();
  });
});

describe("deploy write tools — remaining action + validation branches", () => {
  it("deploy_environment_lifecycle create routes to createProjectEnvironment", async () => {
    apiMocks.createProjectEnvironment.mockClear();
    const reg = await setup();
    const result = await reg
      .getTool("deploy_environment_lifecycle")!
      .handler(
        { action: "create", projectId: "p-1", body: { name: "dev" }, allowWrite: true },
        fakeContext
      );
    expect(apiMocks.createProjectEnvironment).toHaveBeenCalledWith({ accessToken: "tok" }, "p-1", {
      name: "dev",
    });
    expect((result.structuredContent as { action: string }).action).toBe("create");
  });

  it("deploy_environment_lifecycle delete without environmentId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_environment_lifecycle")!
        .handler({ action: "delete", allowWrite: true } as never, fakeContext)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("deploy_repository_manage scope=environment requires environmentId", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("deploy_repository_manage")!
        .handler(
          { scope: "environment", action: "link", body: {}, allowWrite: true } as never,
          fakeContext
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
