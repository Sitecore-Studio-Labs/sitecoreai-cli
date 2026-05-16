import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeployProjectsCommand } from "../../../src/commands/deploy/projects";

const taskMocks = vi.hoisted(() => ({
  runDeployProjectsList: vi.fn(),
  runDeployProjectsLimitation: vi.fn(),
  runDeployProjectsValidateName: vi.fn(),
  runDeployProjectsGet: vi.fn(),
  runDeployProjectsCreate: vi.fn(),
  runDeployProjectsUpdate: vi.fn(),
  runDeployProjectsLinkRepository: vi.fn(),
  runDeployProjectsUnlinkRepository: vi.fn(),
  runDeployProjectsDelete: vi.fn(),
}));

vi.mock("../../../src/deploy/tasks/projects", () => taskMocks);

const runProjects = async (args: string[]): Promise<void> => {
  const command = createDeployProjectsCommand();
  await command.parseAsync(["node", "scai", ...args]);
};

describe("deploy projects command actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs list and limitation actions", async () => {
    await runProjects(["list"]);
    await runProjects(["limitation"]);

    expect(taskMocks.runDeployProjectsList).toHaveBeenCalled();
    expect(taskMocks.runDeployProjectsLimitation).toHaveBeenCalled();
  });

  it("runs validate and get actions", async () => {
    await runProjects(["validate-name", "--name", "Project One"]);
    await runProjects(["get", "--id", "proj-1"]);

    expect(taskMocks.runDeployProjectsValidateName).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Project One" })
    );
    expect(taskMocks.runDeployProjectsGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proj-1" })
    );
  });

  it("runs create and update actions", async () => {
    await runProjects([
      "create",
      "--name",
      "Project Two",
      "--repository-name",
      "repo",
      "--repository-id",
      "repo-1",
      "--source-control-integration-id",
      "sc-1",
    ]);
    await runProjects([
      "update",
      "--id",
      "proj-1",
      "--new-name",
      "Project Updated",
      "--repository-id",
      "repo-2",
    ]);

    expect(taskMocks.runDeployProjectsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Project Two",
        repositoryName: "repo",
        repositoryId: "repo-1",
        sourceControlIntegrationId: "sc-1",
      })
    );
    expect(taskMocks.runDeployProjectsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "proj-1",
        newName: "Project Updated",
        repositoryId: "repo-2",
      })
    );
  });

  it("runs link, unlink, and delete actions", async () => {
    await runProjects([
      "link-repository",
      "--id",
      "proj-1",
      "--repository-id",
      "repo-1",
      "--integration-id",
      "int-1",
      "--repository-relative-path",
      "/",
    ]);
    await runProjects(["unlink-repository", "--id", "proj-1"]);
    await runProjects(["delete", "--name", "Project One", "--force"]);

    expect(taskMocks.runDeployProjectsLinkRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "proj-1",
        repositoryId: "repo-1",
        integrationId: "int-1",
        repositoryRelativePath: "/",
      })
    );
    expect(taskMocks.runDeployProjectsUnlinkRepository).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proj-1" })
    );
    expect(taskMocks.runDeployProjectsDelete).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Project One", force: true })
    );
  });
});
