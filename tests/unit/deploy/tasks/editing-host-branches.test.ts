import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchEnvironment: vi.fn(),
  fetchProjectEnvironments: vi.fn(),
  fetchEnvironments: vi.fn(),
  createProjectEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  createEnvironmentDeployment: vi.fn(),
}));

vi.mock("../../../../src/deploy/api", () => ({
  ...apiMocks,
}));

const sharedMocks = vi.hoisted(() => ({
  extractDeployEnvironmentList: vi.fn(),
  getDeployContext: vi.fn(),
  getEnvironmentType: vi.fn(),
  inputError: (message: string) => new Error(message),
  printDeployResultWithContext: vi.fn(),
  printDeployWhatIf: vi.fn(),
  resolveDeployProjectId: vi.fn(),
  resolveEnvironmentType: vi.fn(),
  resolveProjectIdValue: vi.fn(),
  resolveTenantTypeValue: vi.fn(),
  toLogger: vi.fn(),
}));

vi.mock("../../../../src/deploy/tasks/shared", () => sharedMocks);

const deploymentResultMock = vi.hoisted(() => ({
  printDeploymentResult: vi.fn(),
}));
vi.mock("../../../../src/deploy/tasks/deployment-result", () => deploymentResultMock);

const deploymentsMock = vi.hoisted(() => ({
  runDeployDeploymentsWatch: vi.fn(),
}));
vi.mock("../../../../src/deploy/tasks/deployments", () => deploymentsMock);

describe("editing host branches", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sharedMocks.toLogger.mockReturnValue(logger);
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
    });
    sharedMocks.extractDeployEnvironmentList.mockImplementation((value: unknown) =>
      Array.isArray(value) ? value : []
    );
    apiMocks.fetchProjectEnvironments.mockResolvedValue([
      { id: "eh-1", name: "Editing Host", type: "eh" },
      { id: "cm-1", name: "CM", type: "cm" },
    ]);
  });

  it("lists editing hosts for a project", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue("proj-1");
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);
    const { runDeployEditingHostList } = await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostList({ project: "proj-1" });
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.editing-host.list",
      [{ id: "eh-1", name: "Editing Host", type: "eh" }]
    );
  });

  it("falls back to listing all environments when project lookup fails", async () => {
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      environmentId: "env-1",
    });
    apiMocks.fetchEnvironment.mockRejectedValue(new Error("boom"));
    apiMocks.fetchEnvironments.mockResolvedValue([{ id: "eh-2", type: "eh" }]);
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);

    const { runDeployEditingHostList } = await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostList({});
    expect(apiMocks.fetchEnvironments).toHaveBeenCalled();
  });

  it("rejects deleting a non-editing-host environment", async () => {
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
    });
    apiMocks.fetchEnvironment.mockResolvedValue({ type: "cm" });
    sharedMocks.resolveEnvironmentType.mockReturnValue("cm");

    const { runDeployEditingHostDelete } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(runDeployEditingHostDelete({ id: "env-1" })).rejects.toThrow(
      "Environment env-1 is not an editing host."
    );
  });

  it("runs deployment watch after create when noWatch is false", async () => {
    deploymentResultMock.printDeploymentResult.mockReturnValue("dep-1");
    apiMocks.createEnvironmentDeployment.mockResolvedValue({ id: "dep-1" });

    const { runDeployEditingHostDeploy } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostDeploy({ id: "eh-1", noWatch: false });
    expect(deploymentsMock.runDeployDeploymentsWatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1" })
    );
  });

  it("validates required fields for create and update", async () => {
    const { runDeployEditingHostCreate, runDeployEditingHostUpdate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(runDeployEditingHostCreate({})).rejects.toThrow(
      "CM environment ID is required. Use --cm-environment-id."
    );
    await expect(runDeployEditingHostCreate({ cmEnvironmentId: "env-1" })).rejects.toThrow(
      "Editing host name is required. Use --name."
    );
    await expect(runDeployEditingHostUpdate({ id: "eh-1" })).rejects.toThrow(
      "Editing host name is required. Use --name."
    );
  });

  it("throws when project id cannot be resolved for create", async () => {
    sharedMocks.resolveProjectIdValue.mockReturnValue(undefined);
    apiMocks.fetchEnvironment.mockResolvedValue({ projectId: undefined, tenantType: 0 });
    const { runDeployEditingHostCreate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(
      runDeployEditingHostCreate({ cmEnvironmentId: "env-1", name: "eh" })
    ).rejects.toThrow("Project ID was not available on the CM environment.");
  });

  it("prints what-if for create, update, delete, and deploy", async () => {
    sharedMocks.resolveProjectIdValue.mockReturnValue("proj-1");
    sharedMocks.resolveTenantTypeValue.mockReturnValue(0);
    apiMocks.fetchEnvironment.mockResolvedValue({ projectId: "proj-1", tenantType: 0 });
    const {
      runDeployEditingHostCreate,
      runDeployEditingHostUpdate,
      runDeployEditingHostDelete,
      runDeployEditingHostDeploy,
    } = await import("../../../../src/deploy/tasks/editing-host");

    await runDeployEditingHostCreate({
      cmEnvironmentId: "env-1",
      name: "eh",
      whatIf: true,
    });
    await runDeployEditingHostUpdate({ id: "eh-1", name: "eh", whatIf: true });
    await runDeployEditingHostDelete({ id: "eh-1", whatIf: true });
    await runDeployEditingHostDeploy({ id: "eh-1", whatIf: true });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledTimes(4);
  });

  it("rejects deploy when environment is not an editing host", async () => {
    apiMocks.fetchEnvironment.mockResolvedValue({ type: "cm" });
    sharedMocks.resolveEnvironmentType.mockReturnValue("cm");
    const { runDeployEditingHostDeploy } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(runDeployEditingHostDeploy({ id: "env-1" })).rejects.toThrow(
      "Environment env-1 is not an editing host."
    );
  });
});
