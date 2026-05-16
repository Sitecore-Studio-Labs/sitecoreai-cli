import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeploySourceControlCommand } from "../../../src/commands/deploy/source-control";

const taskMocks = vi.hoisted(() => ({
  runDeploySourceControlList: vi.fn(),
  runDeploySourceControlState: vi.fn(),
  runDeploySourceControlAccessToken: vi.fn(),
  runDeploySourceControlValidate: vi.fn(),
  runDeploySourceControlTemplates: vi.fn(),
  runDeploySourceControlRepositoryGet: vi.fn(),
  runDeploySourceControlRepositoryBranches: vi.fn(),
  runDeploySourceControlRepositoryValidate: vi.fn(),
  runDeploySourceControlRepositoryCreateFromTemplate: vi.fn(),
  runDeploySourceControlProviders: vi.fn(),
  runDeploySourceControlGet: vi.fn(),
  runDeploySourceControlDelete: vi.fn(),
}));

vi.mock("../../../src/deploy/tasks/source-control", () => taskMocks);

const runSourceControl = async (args: string[]): Promise<void> => {
  const command = createDeploySourceControlCommand();
  await command.parseAsync(["node", "scai", ...args]);
};

describe("deploy source-control command actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs top-level source control actions", async () => {
    await runSourceControl(["list"]);
    await runSourceControl(["state"]);
    await runSourceControl(["access-token", "--id", "sc-1"]);
    await runSourceControl(["validate", "--id", "sc-1"]);
    await runSourceControl(["providers"]);
    await runSourceControl(["templates", "--provider", "github"]);
    await runSourceControl(["get", "--id", "sc-1"]);
    await runSourceControl(["delete", "--id", "sc-1"]);

    expect(taskMocks.runDeploySourceControlList).toHaveBeenCalled();
    expect(taskMocks.runDeploySourceControlState).toHaveBeenCalled();
    expect(taskMocks.runDeploySourceControlAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sc-1" })
    );
    expect(taskMocks.runDeploySourceControlValidate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sc-1" })
    );
    expect(taskMocks.runDeploySourceControlProviders).toHaveBeenCalled();
    expect(taskMocks.runDeploySourceControlTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "github" })
    );
    expect(taskMocks.runDeploySourceControlGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sc-1" })
    );
    expect(taskMocks.runDeploySourceControlDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sc-1" })
    );
  });

  it("runs repository actions", async () => {
    await runSourceControl([
      "repository",
      "get",
      "--integration-id",
      "int-1",
      "--repository-id",
      "repo-1",
    ]);
    await runSourceControl([
      "repository",
      "branches",
      "--repository-name",
      "repo",
      "--integration-id",
      "int-1",
    ]);
    await runSourceControl([
      "repository",
      "validate",
      "--integration-id",
      "int-1",
      "--repository-name",
      "repo",
    ]);
    await runSourceControl([
      "repository",
      "create-from-template",
      "--provider",
      "github",
      "--template-repository",
      "template",
      "--template-owner",
      "owner",
      "--repository-name",
      "repo",
      "--owner",
      "owner",
      "--integration-id",
      "int-1",
      "--description",
      "desc",
      "--no-private-repository",
      "--no-include-all-branches",
    ]);

    expect(taskMocks.runDeploySourceControlRepositoryGet).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: "int-1", repositoryId: "repo-1" })
    );
    expect(taskMocks.runDeploySourceControlRepositoryBranches).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: "int-1", repositoryName: "repo" })
    );
    expect(taskMocks.runDeploySourceControlRepositoryValidate).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: "int-1", repositoryName: "repo" })
    );
    expect(taskMocks.runDeploySourceControlRepositoryCreateFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        templateRepository: "template",
        templateOwner: "owner",
        repositoryName: "repo",
        owner: "owner",
        integrationId: "int-1",
        description: "desc",
        privateRepository: false,
        includeAllBranches: false,
      })
    );
  });
});
