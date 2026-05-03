import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchEnvironments: vi.fn(),
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
  createProjectEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
  linkEnvironmentRepository: vi.fn(),
  unlinkEnvironmentRepository: vi.fn(),
  fetchEnvironmentRestartStatus: vi.fn(),
  restartEnvironment: vi.fn(),
  promoteEnvironmentDeployment: vi.fn(),
}));

vi.mock("../../../../src/deploy/api", () => ({
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
  });

  it("filters project environments by type", async () => {
    apiMocks.fetchProjectEnvironments.mockResolvedValue([{ id: "env-1", type: "cm" }]);
    sharedMocks.extractDeployEnvironmentList.mockReturnValue([{ id: "env-1", type: "cm" }]);
    sharedMocks.filterEnvironmentsByType.mockReturnValue([{ id: "env-1", type: "cm" }]);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ project: "proj-1", type: "cm" });

    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.list",
      [{ id: "env-1", type: "cm" }]
    );
  });

  it("lists project environments without type filter", async () => {
    const result = { items: [{ id: "env-1", type: "cm" }] };
    apiMocks.fetchProjectEnvironments.mockResolvedValue(result);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ project: "proj-1" });

    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.list",
      result
    );
  });

  it("lists environments without a type filter", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    const result = { items: [{ id: "env-2", type: "cm" }] };
    apiMocks.fetchEnvironments.mockResolvedValue(result);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({});

    expect(apiMocks.fetchEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      { Types: undefined }
    );
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.environments.list",
      result
    );
  });

  it("falls back when type filter returns empty list", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    apiMocks.fetchEnvironments
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ id: "env-2", type: "cm" }] });
    sharedMocks.extractDeployEnvironmentList
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "env-2", type: "cm" }]);
    sharedMocks.filterEnvironmentsByType.mockReturnValue([{ id: "env-2", type: "cm" }]);

    const { runDeployEnvironmentsList } = await import("../../../../src/deploy/tasks/environments");
    await runDeployEnvironmentsList({ type: "cm" });
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
});
