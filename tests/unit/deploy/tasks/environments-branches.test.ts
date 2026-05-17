import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchEnvironments: vi.fn(),
  fetchAllEnvironments: vi.fn(),
  fetchEnvironmentsLimitation: vi.fn(),
  fetchEnvironment: vi.fn(),
  fetchEnvironmentDeployments: vi.fn(),
  createEnvironmentDeployment: vi.fn(),
  fetchEnvironmentVariables: vi.fn(),
  upsertEnvironmentVariable: vi.fn(),
  deleteEnvironmentVariable: vi.fn(),
  fetchEnvironmentEdgeToken: vi.fn(),
  fetchEnvironmentEditingSecret: vi.fn(),
  regenerateEnvironmentContext: vi.fn(),
  fetchProjectEnvironments: vi.fn(),
  fetchAllProjectEnvironments: vi.fn(),
  createProjectEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
  linkEnvironmentRepository: vi.fn(),
  unlinkEnvironmentRepository: vi.fn(),
  fetchEnvironmentRestartStatus: vi.fn(),
  restartEnvironment: vi.fn(),
  promoteEnvironmentDeployment: vi.fn(),
  probeEnvironmentHealth: vi.fn(),
  resolveHostFromEnvironment: vi.fn(),
}));

vi.mock("../../../../src/deploy/api/environments", () => ({
  ...apiMocks,
}));
vi.mock("../../../../src/deploy/api/projects", () => ({
  ...apiMocks,
}));

const sharedMocks = vi.hoisted(() => ({
  confirmDestructive: vi.fn(),
  extractDeployEnvironmentList: vi.fn(),
  filterEnvironmentsByType: vi.fn(),
  getDeployContext: vi.fn(),
  getEnvironmentType: vi.fn(),
  inputError: (message: string) => new Error(message),
  printDeployResultWithContext: vi.fn(),
  printDeployWhatIf: vi.fn(),
  resolveDeployEnvironmentId: vi.fn(),
  resolveDeployProjectId: vi.fn(),
  toLogger: vi.fn(),
}));

vi.mock("../../../../src/deploy/tasks/shared", () => sharedMocks);

// runDeployEnvironmentsDelete resolves the environment for the
// destructive-tier gate; mock that policy seam so the delete tests
// don't depend on an on-disk config.
const policyMocks = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(),
  ensureAllowWrite: vi.fn(),
}));
vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: policyMocks.resolveEnvironment,
}));
vi.mock("../../../../src/policy/allow-write", () => ({
  ensureAllowWrite: policyMocks.ensureAllowWrite,
}));

const deploymentResultMock = vi.hoisted(() => ({
  printDeploymentResult: vi.fn(),
}));
vi.mock("../../../../src/deploy/tasks/deployment-result", () => deploymentResultMock);

const deploymentsMock = vi.hoisted(() => ({
  runDeployDeploymentsDeploy: vi.fn(),
  runDeployDeploymentsWatch: vi.fn(),
}));
vi.mock("../../../../src/deploy/tasks/deployments", () => deploymentsMock);

describe("deploy environments branches", () => {
  const logger = {
    isJson: vi.fn(),
    info: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sharedMocks.toLogger.mockReturnValue(logger);
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
    });
    sharedMocks.resolveDeployEnvironmentId.mockResolvedValue("env-1");
    sharedMocks.resolveDeployProjectId.mockResolvedValue("proj-1");
    logger.isJson.mockReturnValue(false);
    policyMocks.resolveEnvironment.mockReturnValue({
      root: { environments: {} },
      envName: "test",
      environment: {},
      timeoutMs: undefined,
    });
  });

  it("filters project environments by type (walker default)", async () => {
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "env-1", type: "cm" }],
    });
    sharedMocks.filterEnvironmentsByType.mockReturnValue([{ id: "env-1", type: "cm" }]);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ project: "proj-1", type: "cm" });

    expect(apiMocks.fetchAllProjectEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1",
      50
    );
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.list",
      { totalCount: 1, pageSize: 50, data: [{ id: "env-1", type: "cm" }] }
    );
  });

  it("walks every page for project list without filter (walker default)", async () => {
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "env-1", type: "cm" }],
    });

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ project: "proj-1" });

    expect(apiMocks.fetchAllProjectEnvironments).toHaveBeenCalledTimes(1);
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.list",
      { totalCount: 1, pageSize: 50, data: [{ id: "env-1", type: "cm" }] }
    );
  });

  it("fetches a single page for project list when --page is explicit", async () => {
    apiMocks.fetchProjectEnvironments.mockResolvedValue({
      items: [{ id: "env-1", type: "cm" }],
    });

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ project: "proj-1", page: 2, pageSize: 25 });

    expect(apiMocks.fetchProjectEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1",
      expect.objectContaining({ PageNumber: 2, PageSize: 25 })
    );
    expect(apiMocks.fetchAllProjectEnvironments).not.toHaveBeenCalled();
  });

  it("walks every page for org-wide list by default", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 2,
      pageSize: 50,
      items: [
        { id: "env-2", type: "cm" },
        { id: "env-3", type: "eh" },
      ],
    });

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({});

    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      expect.objectContaining({ Types: undefined }),
      50
    );
    expect(apiMocks.fetchEnvironments).not.toHaveBeenCalled();
  });

  it("honors explicit --all (no behavior change vs default)", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 30,
      pageSize: 50,
      items: [{ id: "a" }, { id: "b" }],
    });

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ all: true });

    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      expect.objectContaining({ Types: undefined }),
      50
    );
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.list",
      { totalCount: 30, pageSize: 50, data: [{ id: "a" }, { id: "b" }] }
    );
  });

  it("forwards --page and --page-size to the single-page fetch", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchEnvironments.mockResolvedValue({ items: [] });

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ page: 3, pageSize: 25 });

    expect(apiMocks.fetchEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      expect.objectContaining({ PageNumber: 3, PageSize: 25 })
    );
    expect(apiMocks.fetchAllEnvironments).not.toHaveBeenCalled();
  });

  it("falls back when the type filter returns empty under the walker default", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchAllEnvironments
      .mockResolvedValueOnce({ totalCount: 0, pageSize: 50, items: [] })
      .mockResolvedValueOnce({
        totalCount: 1,
        pageSize: 50,
        items: [{ id: "env-2", type: "cm" }],
      });
    sharedMocks.filterEnvironmentsByType
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "env-2", type: "cm" }]);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ type: "cm" });
    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalledTimes(2);
  });

  it("falls back when the type filter returns empty under explicit --page", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchEnvironments
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ id: "env-2", type: "cm" }] });
    sharedMocks.extractDeployEnvironmentList
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "env-2", type: "cm" }]);
    sharedMocks.filterEnvironmentsByType.mockReturnValue([{ id: "env-2", type: "cm" }]);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ type: "cm", page: 1 });
    expect(apiMocks.fetchEnvironments).toHaveBeenCalledTimes(2);
  });

  it("prints non-JSON project/name output for environments get", async () => {
    apiMocks.fetchEnvironment.mockResolvedValue({ environmentId: "env-7", type: "cm" });
    sharedMocks.getEnvironmentType.mockReturnValue("cm");

    const { runDeployEnvironmentsGet } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsGet({ project: "proj-1", name: "Env One" });

    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.get",
      { environmentId: "env-7", type: "cm" }
    );
  });

  it("returns environment ID and type for project/name lookups", async () => {
    logger.isJson.mockReturnValue(true);
    apiMocks.fetchEnvironment.mockResolvedValue({ id: "env-1", type: "cm" });
    sharedMocks.getEnvironmentType.mockReturnValue("cm");

    const { runDeployEnvironmentsGet } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsGet({ project: "proj-1", name: "Env One" });

    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.get",
      { id: "env-1", type: "cm" },
      { environmentId: "env-1", type: "cm" }
    );
  });

  it("creates environments with tenant and cmOnly values", async () => {
    apiMocks.createProjectEnvironment.mockResolvedValue({ id: "env-3" });
    const { runDeployEnvironmentsCreate } =
      await import("../../../../src/deploy/tasks/environments");

    await runDeployEnvironmentsCreate({
      project: "proj-1",
      name: "Env",
      tenantType: 1,
      cmOnly: true,
    });

    expect(apiMocks.createProjectEnvironment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1",
      { name: "Env", tenantType: 1, type: "cm" }
    );
  });

  it("prints what-if payloads for create and variable upsert", async () => {
    const { runDeployEnvironmentsCreate, runDeployEnvironmentsVariablesCreate } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsCreate({
      project: "proj-1",
      name: "Env",
      tenantType: 1,
      cmOnly: true,
      whatIf: true,
    });
    await runDeployEnvironmentsVariablesCreate({
      variable: "KEY",
      value: "VALUE",
      whatIf: true,
    });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledTimes(2);
  });

  it("validates variable input data", async () => {
    const { runDeployEnvironmentsVariablesCreate } =
      await import("../../../../src/deploy/tasks/environments");
    await expect(runDeployEnvironmentsVariablesCreate({})).rejects.toThrow(
      "Variable name is required. Use --variable."
    );
    await expect(runDeployEnvironmentsVariablesCreate({ variable: "KEY" })).rejects.toThrow(
      "Variable data is required. Use --value/--target/--secret."
    );
  });

  it("prints what-if payloads for variable delete", async () => {
    const { runDeployEnvironmentsVariablesDelete } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsVariablesDelete({ variable: "KEY", whatIf: true });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.variables.delete",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("prints what-if deployments create with redeploy", async () => {
    const { runDeployEnvironmentsDeploymentsCreate } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsDeploymentsCreate({ redeploy: true, whatIf: true });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.deployments.create",
      expect.objectContaining({
        query: { redeploy: true },
      })
    );
  });

  it("creates deployments and prints results", async () => {
    apiMocks.createEnvironmentDeployment.mockResolvedValue({ id: "dep-1" });
    const { runDeployEnvironmentsDeploymentsCreate } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsDeploymentsCreate({ redeploy: false });

    expect(apiMocks.createEnvironmentDeployment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "env-1",
      false
    );
    expect(deploymentResultMock.printDeploymentResult).toHaveBeenCalled();
  });

  it("halts promote when deployment ID is missing or noStart is set", async () => {
    const { runDeployEnvironmentsPromote } =
      await import("../../../../src/deploy/tasks/environments");
    deploymentResultMock.printDeploymentResult.mockReturnValueOnce(undefined);
    await runDeployEnvironmentsPromote({ sourceId: "dep-1" });
    expect(deploymentsMock.runDeployDeploymentsDeploy).not.toHaveBeenCalled();

    deploymentResultMock.printDeploymentResult.mockReturnValueOnce("dep-2");
    await runDeployEnvironmentsPromote({ sourceId: "dep-1", noStart: true });
    expect(deploymentsMock.runDeployDeploymentsDeploy).not.toHaveBeenCalled();
  });

  it("promotes and deploys with watch", async () => {
    deploymentResultMock.printDeploymentResult.mockReturnValueOnce("dep-9");
    apiMocks.promoteEnvironmentDeployment.mockResolvedValue({ id: "dep-9" });
    const { runDeployEnvironmentsPromote } =
      await import("../../../../src/deploy/tasks/environments");

    await runDeployEnvironmentsPromote({ sourceId: "dep-1", waitForPostActions: true });

    expect(deploymentsMock.runDeployDeploymentsDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-9" })
    );
    expect(deploymentsMock.runDeployDeploymentsWatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-9", waitForPostActions: true })
    );
  });

  it("cancels delete and restart when confirmation is denied", async () => {
    sharedMocks.confirmDestructive.mockResolvedValue(false);
    const { runDeployEnvironmentsDelete, runDeployEnvironmentsRestart } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsDelete({});
    await runDeployEnvironmentsRestart({});
    expect(logger.info).toHaveBeenCalledWith("Delete cancelled.", "yellow");
    expect(logger.info).toHaveBeenCalledWith("Restart cancelled.", "yellow");
  });

  it("deletes environment when confirmed", async () => {
    sharedMocks.confirmDestructive.mockResolvedValue(true);
    apiMocks.deleteEnvironment.mockResolvedValue({ deleted: true });
    const { runDeployEnvironmentsDelete } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsDelete({ force: true });

    expect(apiMocks.deleteEnvironment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "env-1",
      true
    );
  });

  it("dry-runs delete when --what-if is set, even with --force", async () => {
    const { runDeployEnvironmentsDelete } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsDelete({ id: "env-x", whatIf: true, force: true });

    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.delete",
      expect.objectContaining({
        method: "DELETE",
        path: expect.stringContaining("/api/environments/v1/"),
        query: { force: true },
      })
    );
    expect(apiMocks.deleteEnvironment).not.toHaveBeenCalled();
    expect(sharedMocks.confirmDestructive).not.toHaveBeenCalled();
  });

  it("requires all repository link fields", async () => {
    const { runDeployEnvironmentsLinkRepository } =
      await import("../../../../src/deploy/tasks/environments");
    await expect(runDeployEnvironmentsLinkRepository({ repositoryName: "repo" })).rejects.toThrow(
      "Environment repository link requires"
    );
  });

  it("prints what-if for repository unlink and restart", async () => {
    const { runDeployEnvironmentsUnlinkRepository, runDeployEnvironmentsRestart } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsUnlinkRepository({ whatIf: true });
    await runDeployEnvironmentsRestart({ whatIf: true });

    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.repository.unlink",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.restart",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("prints the org-wide single-page result directly when a type filter matches rows", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchEnvironments.mockResolvedValue({ items: [{ id: "env-1", type: "cm" }] });
    sharedMocks.extractDeployEnvironmentList.mockReturnValue([{ id: "env-1", type: "cm" }]);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ type: "cm", page: 1 });

    // list.length > 0 → no fallback re-fetch.
    expect(apiMocks.fetchEnvironments).toHaveBeenCalledTimes(1);
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.list",
      { items: [{ id: "env-1", type: "cm" }] }
    );
  });

  it("does not re-walk when the walker type filter finds rows or totalCount is positive", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 3,
      pageSize: 50,
      items: [{ id: "env-1", type: "cm" }],
    });
    sharedMocks.filterEnvironmentsByType.mockReturnValue([]);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ type: "cm" });

    // filteredData empty but totalCount > 0 → fallback condition is false.
    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalledTimes(1);
  });

  it("upserts an environment variable when --what-if is unset", async () => {
    apiMocks.upsertEnvironmentVariable.mockResolvedValue({ name: "KEY" });
    const { runDeployEnvironmentsVariablesCreate } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsVariablesCreate({ variable: "KEY", value: "VALUE" });

    expect(apiMocks.upsertEnvironmentVariable).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "env-1",
      "KEY",
      { value: "VALUE", target: undefined, secret: undefined }
    );
  });

  it("deletes an environment variable when --what-if is unset", async () => {
    apiMocks.deleteEnvironmentVariable.mockResolvedValue({ deleted: true });
    const { runDeployEnvironmentsVariablesDelete } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsVariablesDelete({ variable: "KEY" });

    expect(apiMocks.deleteEnvironmentVariable).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "env-1",
      "KEY"
    );
  });

  it("prints what-if for regenerate-context and runs the API call otherwise", async () => {
    apiMocks.regenerateEnvironmentContext.mockResolvedValue({ ok: true });
    const { runDeployEnvironmentsRegenerateContext } =
      await import("../../../../src/deploy/tasks/environments");

    await runDeployEnvironmentsRegenerateContext({ whatIf: true });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.regenerate-context",
      expect.objectContaining({ method: "POST" })
    );

    await runDeployEnvironmentsRegenerateContext({});
    expect(apiMocks.regenerateEnvironmentContext).toHaveBeenCalled();
  });

  it("links a repository when all fields are present and --what-if is unset", async () => {
    apiMocks.linkEnvironmentRepository.mockResolvedValue({ linked: true });
    const { runDeployEnvironmentsLinkRepository } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsLinkRepository({
      repositoryName: "repo",
      repositoryId: "rid",
      integrationId: "iid",
      repositoryRelativePath: "/",
      repositoryBranch: "main",
    });

    expect(apiMocks.linkEnvironmentRepository).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "env-1",
      expect.objectContaining({
        repository: "repo",
        repositoryId: "rid",
        integrationId: "iid",
        repositoryRelativePath: "/",
        repositoryBranch: "main",
      })
    );
  });

  it("prints what-if for repository link without calling the API", async () => {
    const { runDeployEnvironmentsLinkRepository } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsLinkRepository({
      repositoryName: "repo",
      repositoryId: "rid",
      integrationId: "iid",
      repositoryRelativePath: "/",
      repositoryBranch: "main",
      whatIf: true,
    });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.repository.link",
      expect.objectContaining({ method: "PUT" })
    );
    expect(apiMocks.linkEnvironmentRepository).not.toHaveBeenCalled();
  });

  it("restarts the environment when destructive confirmation is granted", async () => {
    sharedMocks.confirmDestructive.mockResolvedValue(true);
    apiMocks.restartEnvironment.mockResolvedValue({ restarted: true });
    const { runDeployEnvironmentsRestart } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsRestart({});

    expect(apiMocks.restartEnvironment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "env-1"
    );
  });

  it("probes environment health against the resolved host", async () => {
    apiMocks.fetchEnvironment.mockResolvedValue({ cmHost: "https://cm.example" });
    apiMocks.resolveHostFromEnvironment.mockReturnValue("https://cm.example");
    apiMocks.probeEnvironmentHealth.mockResolvedValue({ ready: true });
    const { runDeployEnvironmentsHealth } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsHealth({});

    expect(apiMocks.probeEnvironmentHealth).toHaveBeenCalledWith("https://cm.example");
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.health",
      { ready: true }
    );
  });

  it("throws when the environment has no resolvable host for a health probe", async () => {
    apiMocks.fetchEnvironment.mockResolvedValue({});
    apiMocks.resolveHostFromEnvironment.mockReturnValue(undefined);
    const { runDeployEnvironmentsHealth } =
      await import("../../../../src/deploy/tasks/environments");
    await expect(runDeployEnvironmentsHealth({})).rejects.toThrow(/no resolvable host/);
    expect(apiMocks.probeEnvironmentHealth).not.toHaveBeenCalled();
  });

  it("swallows CONFIG_NOT_FOUND from the delete policy gate (mocked-context tests)", async () => {
    const { createScaiError } = await import("../../../../src/shared/errors");
    policyMocks.resolveEnvironment.mockImplementation(() => {
      throw createScaiError("no config", "CONFIG_NOT_FOUND");
    });
    sharedMocks.confirmDestructive.mockResolvedValue(true);
    apiMocks.deleteEnvironment.mockResolvedValue({ deleted: true });
    const { runDeployEnvironmentsDelete } =
      await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsDelete({ force: true });
    // The CONFIG_NOT_FOUND is swallowed; delete still proceeds.
    expect(apiMocks.deleteEnvironment).toHaveBeenCalled();
  });

  it("re-throws a non-CONFIG_NOT_FOUND error from the delete policy gate", async () => {
    const { createScaiError } = await import("../../../../src/shared/errors");
    policyMocks.resolveEnvironment.mockImplementation(() => {
      throw createScaiError("policy says no", "POLICY_DENIED");
    });
    const { runDeployEnvironmentsDelete } =
      await import("../../../../src/deploy/tasks/environments");
    await expect(runDeployEnvironmentsDelete({})).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
    expect(apiMocks.deleteEnvironment).not.toHaveBeenCalled();
  });
});
