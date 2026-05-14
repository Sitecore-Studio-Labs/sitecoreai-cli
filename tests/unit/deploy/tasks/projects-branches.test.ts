import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  fetchAllProjects: vi.fn(),
  fetchProjectsLimitation: vi.fn(),
  validateProjectName: vi.fn(),
  fetchProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  linkProjectRepository: vi.fn(),
  unlinkProjectRepository: vi.fn(),
}));

vi.mock("../../../../src/deploy/api", () => ({
  ...apiMocks,
}));

const sharedMocks = vi.hoisted(() => ({
  confirmDestructive: vi.fn(),
  getDeployContext: vi.fn(),
  inputError: (message: string) => new Error(message),
  printDeployResultWithContext: vi.fn(),
  printDeployWhatIf: vi.fn(),
  selectMatch: vi.fn(),
  toLogger: vi.fn(),
}));

vi.mock("../../../../src/deploy/tasks/shared", () => sharedMocks);

describe("deploy projects branches", () => {
  const logger = {
    info: vi.fn(),
    isJson: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sharedMocks.toLogger.mockReturnValue(logger);
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
      projectId: "proj-1",
    });
  });

  it("validates required options and what-if constraints", async () => {
    const {
      runDeployProjectsValidateName,
      runDeployProjectsDelete,
      runDeployProjectsUpdate,
      runDeployProjectsUnlinkRepository,
    } = await import("../../../../src/deploy/tasks/projects");

    await expect(runDeployProjectsValidateName({})).rejects.toThrow(
      "Project name is required. Use --name."
    );
    await expect(runDeployProjectsDelete({ whatIf: true, name: "Name Only" })).rejects.toThrow(
      "Project ID is required for --what-if. Use --id."
    );
    await expect(runDeployProjectsUpdate({ whatIf: true, name: "Name Only" })).rejects.toThrow(
      "Project ID is required for --what-if. Use --id."
    );
    await expect(
      runDeployProjectsUnlinkRepository({ whatIf: true, name: "Name Only" })
    ).rejects.toThrow("Project ID is required for --what-if. Use --id.");
  });

  it("lists projects and limitations", async () => {
    apiMocks.fetchProjects.mockResolvedValue([{ id: "proj-1" }]);
    apiMocks.fetchProjectsLimitation.mockResolvedValue({ limit: 1 });
    const { runDeployProjectsList, runDeployProjectsLimitation } =
      await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsList({});
    await runDeployProjectsLimitation({});
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.projects.list",
      [{ id: "proj-1" }]
    );
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.projects.limitation",
      { limit: 1 }
    );
  });

  it("validates project name in success path", async () => {
    apiMocks.validateProjectName.mockResolvedValue({ valid: true });
    const { runDeployProjectsValidateName } = await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsValidateName({ name: "Project One" });
    expect(apiMocks.validateProjectName).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "Project One"
    );
  });

  it("requires project id when none is available", async () => {
    sharedMocks.getDeployContext.mockResolvedValueOnce({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
    });
    const { runDeployProjectsGet } = await import("../../../../src/deploy/tasks/projects");
    await expect(runDeployProjectsGet({})).rejects.toThrow(
      "Project ID is required. Use --id/--name or set it in config."
    );
  });

  it("prints what-if for create and update", async () => {
    const { runDeployProjectsCreate, runDeployProjectsUpdate } =
      await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsCreate({ name: "New Project", whatIf: true });
    await runDeployProjectsUpdate({ id: "proj-1", newName: "Next", whatIf: true });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledTimes(2);
  });

  it("creates a project with repository data", async () => {
    apiMocks.createProject.mockResolvedValue({ id: "proj-2" });
    const { runDeployProjectsCreate } = await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsCreate({
      name: "New Project",
      repositoryName: "repo",
      repositoryId: "repo-1",
      sourceControlIntegrationId: "sc-1",
    });

    expect(apiMocks.createProject).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      {
        name: "New Project",
        repository: "repo",
        repositoryId: "repo-1",
        integrationId: "sc-1",
      }
    );
  });

  it("cancels delete when not confirmed", async () => {
    sharedMocks.confirmDestructive.mockResolvedValue(false);
    const { runDeployProjectsDelete } = await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsDelete({ id: "proj-1" });
    expect(logger.info).toHaveBeenCalledWith("Delete cancelled.", "yellow");
    expect(apiMocks.deleteProject).not.toHaveBeenCalled();
  });

  it("deletes project by id when confirmed", async () => {
    sharedMocks.confirmDestructive.mockResolvedValue(true);
    apiMocks.deleteProject.mockResolvedValue({ deleted: true });
    const { runDeployProjectsDelete } = await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsDelete({ id: "proj-1" });

    expect(apiMocks.deleteProject).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1"
    );
  });

  it("deletes project by name when resolved", async () => {
    sharedMocks.confirmDestructive.mockResolvedValue(true);
    apiMocks.fetchAllProjects.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "proj-9", name: "Project Nine" }],
    });
    sharedMocks.selectMatch.mockReturnValue({ projectId: "proj-9" });
    const { runDeployProjectsDelete } = await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsDelete({ name: "Project Nine" });

    expect(apiMocks.deleteProject).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-9"
    );
  });

  it("errors when project id cannot be resolved", async () => {
    sharedMocks.confirmDestructive.mockResolvedValue(true);
    apiMocks.fetchAllProjects.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "p1", name: "Project One" }],
    });
    sharedMocks.selectMatch.mockReturnValue({});
    const { runDeployProjectsDelete } = await import("../../../../src/deploy/tasks/projects");
    await expect(runDeployProjectsDelete({ name: "Project One" })).rejects.toThrow(
      "Project ID was not available."
    );
  });

  it("requires update data fields", async () => {
    apiMocks.fetchAllProjects.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "proj-1", name: "Project One" }],
    });
    sharedMocks.selectMatch.mockReturnValue({ id: "proj-1" });
    const { runDeployProjectsUpdate } = await import("../../../../src/deploy/tasks/projects");
    await expect(runDeployProjectsUpdate({ name: "Project One" })).rejects.toThrow(
      "Project update requires --new-name/--repository-name/--repository-id/--source-control-integration-id."
    );
  });

  it("updates project when id is provided", async () => {
    apiMocks.updateProject.mockResolvedValue({ id: "proj-1" });
    const { runDeployProjectsUpdate } = await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsUpdate({
      id: "proj-1",
      newName: "Updated",
      sourceControlIntegrationId: "sc-1",
    });

    expect(apiMocks.updateProject).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1",
      { name: "Updated", sourceControlIntegrationId: "sc-1" }
    );
    expect(apiMocks.fetchProjects).not.toHaveBeenCalled();
  });

  it("requires repository link fields", async () => {
    const { runDeployProjectsLinkRepository } =
      await import("../../../../src/deploy/tasks/projects");
    await expect(runDeployProjectsLinkRepository({ id: "proj-1" })).rejects.toThrow(
      "Repository link requires: repositoryId, integrationId."
    );
  });

  it("links repository with what-if and real call", async () => {
    apiMocks.linkProjectRepository.mockResolvedValue({ linked: true });
    const { runDeployProjectsLinkRepository } =
      await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsLinkRepository({
      id: "proj-1",
      repositoryId: "repo-1",
      integrationId: "sc-1",
      whatIf: true,
    });
    await runDeployProjectsLinkRepository({
      id: "proj-1",
      repositoryId: "repo-1",
      integrationId: "sc-1",
    });

    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.projects.repository.link",
      expect.objectContaining({ method: "PUT" })
    );
    expect(apiMocks.linkProjectRepository).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1",
      { repositoryId: "repo-1", integrationId: "sc-1" }
    );
  });

  it("unlinks repository with and without what-if", async () => {
    apiMocks.unlinkProjectRepository.mockResolvedValue({ unlinked: true });
    const { runDeployProjectsUnlinkRepository } =
      await import("../../../../src/deploy/tasks/projects");
    await runDeployProjectsUnlinkRepository({ id: "proj-1", whatIf: true });
    await runDeployProjectsUnlinkRepository({ id: "proj-1" });

    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.projects.repository.unlink",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(apiMocks.unlinkProjectRepository).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "proj-1"
    );
  });
});
