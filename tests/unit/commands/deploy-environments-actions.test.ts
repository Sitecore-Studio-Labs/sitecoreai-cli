import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeployEnvironmentsCommand } from "../../../src/commands/deploy/environments";

const taskMocks = vi.hoisted(() => ({
  runDeployEnvironmentsList: vi.fn(),
  runDeployEnvironmentsLimitation: vi.fn(),
  runDeployEnvironmentsGet: vi.fn(),
  runDeployEnvironmentsGetEdgeToken: vi.fn(),
  runDeployEnvironmentsGetEditingSecret: vi.fn(),
  runDeployEnvironmentsVariablesList: vi.fn(),
  runDeployEnvironmentsVariablesCreate: vi.fn(),
  runDeployEnvironmentsVariablesDelete: vi.fn(),
  runDeployEnvironmentsDeploymentsList: vi.fn(),
  runDeployEnvironmentsDeploymentsCreate: vi.fn(),
  runDeployEnvironmentsCreate: vi.fn(),
  runDeployEnvironmentsRegenerateContext: vi.fn(),
  runDeployEnvironmentsPromote: vi.fn(),
  runDeployEnvironmentsRestartStatus: vi.fn(),
  runDeployEnvironmentsRestart: vi.fn(),
  runDeployEnvironmentsLinkRepository: vi.fn(),
  runDeployEnvironmentsUnlinkRepository: vi.fn(),
  runDeployEnvironmentsDelete: vi.fn(),
}));

vi.mock("../../../src/serialization/tasks", () => taskMocks);

const runEnvironments = async (args: string[]): Promise<void> => {
  const command = createDeployEnvironmentsCommand();
  await command.parseAsync(["node", "scai", ...args]);
};

describe("deploy environments command actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs query actions", async () => {
    await runEnvironments(["list", "--project", "proj-1", "--type", "cm"]);
    await runEnvironments(["limitation"]);
    await runEnvironments(["get", "--id", "env-1"]);
    await runEnvironments(["get-edge-token", "--name", "Env One"]);
    await runEnvironments(["get-editing-secret", "--name", "Env One"]);

    expect(taskMocks.runDeployEnvironmentsList).toHaveBeenCalledWith(
      expect.objectContaining({ project: "proj-1", type: "cm" })
    );
    expect(taskMocks.runDeployEnvironmentsLimitation).toHaveBeenCalled();
    expect(taskMocks.runDeployEnvironmentsGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1" })
    );
    expect(taskMocks.runDeployEnvironmentsGetEdgeToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Env One" })
    );
    expect(taskMocks.runDeployEnvironmentsGetEditingSecret).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Env One" })
    );
  });

  it("runs variables and deployments actions", async () => {
    await runEnvironments(["variables", "list", "--id", "env-1"]);
    await runEnvironments([
      "variables",
      "create",
      "--id",
      "env-1",
      "--variable",
      "KEY",
      "--value",
      "VAL",
    ]);
    await runEnvironments(["variables", "delete", "--id", "env-1", "--variable", "KEY"]);
    await runEnvironments(["deployments", "list", "--id", "env-1"]);
    await runEnvironments(["deployments", "create", "--id", "env-1", "--redeploy"]);

    expect(taskMocks.runDeployEnvironmentsVariablesList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1" })
    );
    expect(taskMocks.runDeployEnvironmentsVariablesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", variable: "KEY", value: "VAL" })
    );
    expect(taskMocks.runDeployEnvironmentsVariablesDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", variable: "KEY" })
    );
    expect(taskMocks.runDeployEnvironmentsDeploymentsList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1" })
    );
    expect(taskMocks.runDeployEnvironmentsDeploymentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", redeploy: true })
    );
  });

  it("runs mutation actions", async () => {
    await runEnvironments([
      "create",
      "--project",
      "proj-1",
      "--name",
      "Env",
      "--tenant-type",
      "1",
      "--cm-only",
    ]);
    await runEnvironments(["regenerate-context", "--id", "env-1"]);
    await runEnvironments(["promote", "--id", "env-1", "--source-id", "dep-1", "--timeout", "5"]);
    await runEnvironments(["restart", "--id", "env-1", "--status"]);
    await runEnvironments(["restart", "--id", "env-1", "--force"]);
    await runEnvironments([
      "link-repository",
      "--id",
      "env-1",
      "--repository-id",
      "repo-1",
      "--integration-id",
      "int-1",
      "--repository-branch",
      "main",
    ]);
    await runEnvironments(["unlink-repository", "--id", "env-1"]);
    await runEnvironments(["delete", "--id", "env-1", "--force"]);

    expect(taskMocks.runDeployEnvironmentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ project: "proj-1", name: "Env", tenantType: 1, cmOnly: true })
    );
    expect(taskMocks.runDeployEnvironmentsRegenerateContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1" })
    );
    expect(taskMocks.runDeployEnvironmentsPromote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", sourceId: "dep-1", timeout: 5 })
    );
    expect(taskMocks.runDeployEnvironmentsRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", status: true })
    );
    expect(taskMocks.runDeployEnvironmentsRestart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", force: true })
    );
    expect(taskMocks.runDeployEnvironmentsLinkRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "env-1",
        repositoryId: "repo-1",
        integrationId: "int-1",
        repositoryBranch: "main",
      })
    );
    expect(taskMocks.runDeployEnvironmentsUnlinkRepository).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1" })
    );
    expect(taskMocks.runDeployEnvironmentsDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", force: true })
    );
  });
});
