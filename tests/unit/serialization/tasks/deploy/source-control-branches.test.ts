import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchSourceControlIntegrations: vi.fn(),
  fetchSourceControlIntegrationState: vi.fn(),
  fetchSourceControlAccessToken: vi.fn(),
  validateSourceControlIntegration: vi.fn(),
  validateSourceControlRepository: vi.fn(),
  fetchSourceControlRepository: vi.fn(),
  fetchSourceControlRepositoryBranches: vi.fn(),
  fetchSourceControlTemplates: vi.fn(),
  createSourceControlRepository: vi.fn(),
  createSourceControlRepositoryGithub: vi.fn(),
  fetchSourceControlProviders: vi.fn(),
  fetchSourceControlIntegration: vi.fn(),
  deleteSourceControlIntegration: vi.fn(),
}));

vi.mock("../../../../../src/deploy/api", () => ({
  ...apiMocks,
}));

const sharedMocks = vi.hoisted(() => ({
  getDeployContext: vi.fn(),
  inputError: (message: string) => new Error(message),
  printDeployResultWithContext: vi.fn(),
  printDeployWhatIf: vi.fn(),
  toLogger: vi.fn(),
}));

vi.mock("../../../../../src/serialization/tasks/shared", () => sharedMocks);

describe("deploy source control branches", () => {
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
      organizationId: "sc-1",
    });
  });

  it("validates required options for access token and validation", async () => {
    const { runDeploySourceControlAccessToken, runDeploySourceControlValidate } =
      await import("../../../../../src/serialization/tasks/deploy/source-control");
    await expect(runDeploySourceControlAccessToken({})).rejects.toThrow(
      "Source control integration ID is required. Use --id."
    );
    await expect(runDeploySourceControlValidate({})).rejects.toThrow(
      "Source control integration ID is required. Use --id."
    );
  });

  it("validates required repository options", async () => {
    const {
      runDeploySourceControlRepositoryGet,
      runDeploySourceControlRepositoryBranches,
      runDeploySourceControlRepositoryValidate,
    } = await import("../../../../../src/serialization/tasks/deploy/source-control");
    await expect(runDeploySourceControlRepositoryGet({})).rejects.toThrow(
      "Integration ID and repository ID are required."
    );
    await expect(runDeploySourceControlRepositoryBranches({})).rejects.toThrow(
      "Integration ID and repository name are required."
    );
    await expect(runDeploySourceControlRepositoryValidate({})).rejects.toThrow(
      "Integration ID and repository name are required."
    );
  });

  it("validates required create-from-template options", async () => {
    const { runDeploySourceControlRepositoryCreateFromTemplate } =
      await import("../../../../../src/serialization/tasks/deploy/source-control");
    await expect(runDeploySourceControlRepositoryCreateFromTemplate({})).rejects.toThrow(
      "Provider is required. Use --provider."
    );
    await expect(
      runDeploySourceControlRepositoryCreateFromTemplate({ provider: "github" })
    ).rejects.toThrow("Template repository and owner are required.");
    await expect(
      runDeploySourceControlRepositoryCreateFromTemplate({
        provider: "github",
        templateRepository: "template",
        templateOwner: "owner",
      })
    ).rejects.toThrow("Repository name, owner, and integration ID are required.");
  });

  it("prints what-if for github and non-github template creation", async () => {
    const { runDeploySourceControlRepositoryCreateFromTemplate } =
      await import("../../../../../src/serialization/tasks/deploy/source-control");
    await runDeploySourceControlRepositoryCreateFromTemplate({
      provider: "github",
      templateRepository: "template",
      templateOwner: "owner",
      repositoryName: "repo",
      owner: "owner",
      integrationId: "sc-1",
      whatIf: true,
    });
    await runDeploySourceControlRepositoryCreateFromTemplate({
      provider: "gitlab",
      templateRepository: "template",
      templateOwner: "owner",
      repositoryName: "repo",
      owner: "owner",
      integrationId: "sc-1",
      whatIf: true,
    });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledTimes(2);
    expect(apiMocks.createSourceControlRepositoryGithub).not.toHaveBeenCalled();
    expect(apiMocks.createSourceControlRepository).not.toHaveBeenCalled();
  });

  it("uses organization id fallback for get and delete", async () => {
    const { runDeploySourceControlGet, runDeploySourceControlDelete } =
      await import("../../../../../src/serialization/tasks/deploy/source-control");
    await runDeploySourceControlGet({});
    await runDeploySourceControlDelete({ whatIf: true });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.source-control.delete",
      expect.objectContaining({ path: "/api/sourcecontrol/v1/integration/sc-1" })
    );
  });

  it("throws when integration id is missing for get/delete", async () => {
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "demo",
    });
    const { runDeploySourceControlGet, runDeploySourceControlDelete } =
      await import("../../../../../src/serialization/tasks/deploy/source-control");
    await expect(runDeploySourceControlGet({})).rejects.toThrow(
      "Source control integration ID is required. Use --id."
    );
    await expect(runDeploySourceControlDelete({})).rejects.toThrow(
      "Source control integration ID is required. Use --id."
    );
  });
});
