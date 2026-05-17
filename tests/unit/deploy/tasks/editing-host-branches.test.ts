import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchEnvironment: vi.fn(),
  fetchProjectEnvironments: vi.fn(),
  fetchAllProjectEnvironments: vi.fn(),
  fetchEnvironments: vi.fn(),
  fetchAllEnvironments: vi.fn(),
  createProjectEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  createEnvironmentDeployment: vi.fn(),
}));

vi.mock("../../../../src/deploy/api/environments", () => ({
  ...apiMocks,
}));
vi.mock("../../../../src/deploy/api/projects", () => ({
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
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      totalCount: 2,
      pageSize: 50,
      items: [
        { id: "eh-1", name: "Editing Host", type: "eh" },
        { id: "cm-1", name: "CM", type: "cm" },
      ],
    });
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 0,
      pageSize: 50,
      items: [],
    });
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
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "eh-2", type: "eh" }],
    });
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);

    const { runDeployEditingHostList } = await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostList({});
    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalled();
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

  it("create reuses an existing editing host that matches name + cmEnvironmentId", async () => {
    sharedMocks.resolveProjectIdValue.mockReturnValue("proj-1");
    sharedMocks.resolveTenantTypeValue.mockReturnValue(0);
    apiMocks.fetchEnvironment.mockResolvedValue({ projectId: "proj-1", tenantType: 0 });
    sharedMocks.getEnvironmentType.mockReturnValue("eh");
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      items: [
        {
          id: "eh-1",
          name: "my-eh",
          type: "eh",
          editingHostEnvironmentDetails: { cmEnvironmentId: "cm-9" },
        },
      ],
    });

    const { runDeployEditingHostCreate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostCreate({ cmEnvironmentId: "cm-9", name: "my-eh" });

    // Reuse → no POST, prints under the create key with reused:true.
    expect(apiMocks.createProjectEnvironment).not.toHaveBeenCalled();
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.editing-host.create",
      expect.objectContaining({ id: "eh-1", reused: true })
    );
  });

  it("create throws INPUT_INVALID when multiple editing hosts match", async () => {
    sharedMocks.resolveProjectIdValue.mockReturnValue("proj-1");
    sharedMocks.resolveTenantTypeValue.mockReturnValue(0);
    apiMocks.fetchEnvironment.mockResolvedValue({ projectId: "proj-1", tenantType: 0 });
    sharedMocks.getEnvironmentType.mockReturnValue("eh");
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      items: [
        {
          id: "eh-1",
          name: "my-eh",
          type: "eh",
          editingHostEnvironmentDetails: { cmEnvironmentId: "cm-9" },
        },
        {
          id: "eh-2",
          name: "my-eh",
          type: "eh",
          editingHostEnvironmentDetails: { cmEnvironmentId: "cm-9" },
        },
      ],
    });

    const { runDeployEditingHostCreate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(
      runDeployEditingHostCreate({ cmEnvironmentId: "cm-9", name: "my-eh" })
    ).rejects.toThrow("Found 2 editing hosts named 'my-eh'");
  });

  it("create POSTs a new editing host when no match exists", async () => {
    sharedMocks.resolveProjectIdValue.mockReturnValue("proj-1");
    sharedMocks.resolveTenantTypeValue.mockReturnValue(2);
    apiMocks.fetchEnvironment.mockResolvedValue({ projectId: "proj-1", tenantType: 2 });
    sharedMocks.getEnvironmentType.mockReturnValue("cm");
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      items: [{ id: "cm-1", name: "CM", type: "cm" }],
    });
    apiMocks.createProjectEnvironment.mockResolvedValue({ id: "eh-new" });

    const { runDeployEditingHostCreate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostCreate({ cmEnvironmentId: "cm-9", name: "my-eh" });

    expect(apiMocks.createProjectEnvironment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1",
      expect.objectContaining({
        name: "my-eh",
        type: "eh",
        tenantType: 2,
        editingHostEnvironmentDetails: { cmEnvironmentId: "cm-9" },
      })
    );
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.anything(),
      "deploy.editing-host.create",
      { id: "eh-new" }
    );
  });

  it("create defaults tenantType to 0 when the CM environment has none", async () => {
    sharedMocks.resolveProjectIdValue.mockReturnValue("proj-1");
    sharedMocks.resolveTenantTypeValue.mockReturnValue(undefined);
    apiMocks.fetchEnvironment.mockResolvedValue({ projectId: "proj-1" });
    sharedMocks.getEnvironmentType.mockReturnValue("cm");
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({ items: [] });
    apiMocks.createProjectEnvironment.mockResolvedValue({ id: "eh-new" });

    const { runDeployEditingHostCreate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostCreate({ cmEnvironmentId: "cm-9", name: "my-eh" });

    expect(apiMocks.createProjectEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({ tenantType: 0 })
    );
  });

  it("list paginates one page when --page is set", async () => {
    sharedMocks.resolveDeployProjectId.mockResolvedValue("proj-1");
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);
    apiMocks.fetchProjectEnvironments.mockResolvedValue([{ id: "eh-1", type: "eh" }]);

    const { runDeployEditingHostList } = await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostList({ project: "proj-1", page: 2, pageSize: 10 });

    expect(apiMocks.fetchProjectEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1",
      { PageNumber: 2, PageSize: 10 }
    );
    expect(apiMocks.fetchAllProjectEnvironments).not.toHaveBeenCalled();
  });

  it("list uses context.projectId when no --project flag is given", async () => {
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      projectId: "ctx-proj",
    });
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);

    const { runDeployEditingHostList } = await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostList({});

    expect(apiMocks.fetchAllProjectEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "ctx-proj",
      50
    );
  });

  it("list walks every environment org-wide when no project id resolves", async () => {
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);

    const { runDeployEditingHostList } = await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostList({});

    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      {},
      50
    );
  });

  it("list paginates org-wide one page when --page is set and no project id resolves", async () => {
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);
    apiMocks.fetchEnvironments.mockResolvedValue([{ id: "eh-3", type: "eh" }]);

    const { runDeployEditingHostList } = await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostList({ page: 1, pageSize: 5 });

    expect(apiMocks.fetchEnvironments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      { PageNumber: 1, PageSize: 5 }
    );
  });

  it("delete calls deleteEnvironment in apply mode, forwarding force", async () => {
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      editingHostEnvironmentIds: ["eh-1"],
    });
    apiMocks.deleteEnvironment.mockResolvedValue({ deleted: true });

    const { runDeployEditingHostDelete } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostDelete({ id: "eh-1", force: true });

    expect(apiMocks.deleteEnvironment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "eh-1",
      true
    );
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.anything(),
      "deploy.editing-host.delete",
      { deleted: true }
    );
  });

  it("delete skips the type-check when the id is a known editing host", async () => {
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      editingHostEnvironmentIds: ["eh-1"],
    });

    const { runDeployEditingHostDelete } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostDelete({ id: "eh-1", whatIf: true });

    expect(apiMocks.fetchEnvironment).not.toHaveBeenCalled();
  });

  it("delete throws INPUT_INVALID when no id is given", async () => {
    const { runDeployEditingHostDelete } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(runDeployEditingHostDelete({})).rejects.toThrow(
      "Editing host environment ID is required. Use --id."
    );
  });

  it("update calls updateEnvironment in apply mode", async () => {
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      environmentType: "eh",
      environmentId: "eh-1",
    });
    apiMocks.updateEnvironment.mockResolvedValue({ updated: true });

    const { runDeployEditingHostUpdate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostUpdate({ id: "eh-1", name: "renamed" });

    expect(apiMocks.updateEnvironment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "eh-1",
      { name: "renamed" }
    );
  });

  it("update throws INPUT_INVALID when no id is given", async () => {
    const { runDeployEditingHostUpdate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(runDeployEditingHostUpdate({})).rejects.toThrow(
      "Editing host environment ID is required. Use --id."
    );
  });

  it("update rejects a non-editing-host environment", async () => {
    apiMocks.fetchEnvironment.mockResolvedValue({ type: "cm" });
    sharedMocks.resolveEnvironmentType.mockReturnValue("cm");

    const { runDeployEditingHostUpdate } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(runDeployEditingHostUpdate({ id: "env-1", name: "x" })).rejects.toThrow(
      "Environment env-1 is not an editing host."
    );
  });

  it("deploy throws INPUT_INVALID when no id is given", async () => {
    const { runDeployEditingHostDeploy } =
      await import("../../../../src/deploy/tasks/editing-host");
    await expect(runDeployEditingHostDeploy({})).rejects.toThrow(
      "Editing host environment ID is required. Use --id."
    );
  });

  it("deploy does not run watch when noWatch is true", async () => {
    deploymentResultMock.printDeploymentResult.mockReturnValue("dep-1");
    apiMocks.createEnvironmentDeployment.mockResolvedValue({ id: "dep-1" });
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      editingHostEnvironmentIds: ["eh-1"],
    });

    const { runDeployEditingHostDeploy } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostDeploy({ id: "eh-1", noWatch: true });

    expect(apiMocks.createEnvironmentDeployment).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "eh-1",
      undefined
    );
    expect(deploymentsMock.runDeployDeploymentsWatch).not.toHaveBeenCalled();
  });

  it("deploy does not run watch when printDeploymentResult yields no deployment id", async () => {
    deploymentResultMock.printDeploymentResult.mockReturnValue(undefined);
    apiMocks.createEnvironmentDeployment.mockResolvedValue({});
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      editingHostEnvironmentIds: ["eh-1"],
    });

    const { runDeployEditingHostDeploy } =
      await import("../../../../src/deploy/tasks/editing-host");
    await runDeployEditingHostDeploy({ id: "eh-1", noWatch: false });

    expect(deploymentsMock.runDeployDeploymentsWatch).not.toHaveBeenCalled();
  });
});
