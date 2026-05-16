import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeployDeploymentsCommand } from "../../../src/commands/deploy/deployments";

const taskMocks = vi.hoisted(() => ({
  runDeployDeploymentsList: vi.fn(),
  runDeployDeploymentsGet: vi.fn(),
  runDeployDeploymentsStatus: vi.fn(),
  runDeployDeploymentsDeploy: vi.fn(),
  runDeployDeploymentsCancel: vi.fn(),
  runDeployDeploymentsSource: vi.fn(),
  runDeployDeploymentsWatch: vi.fn(),
  runDeployDeploymentLogs: vi.fn(),
}));

vi.mock("../../../src/deploy/tasks/deployments", () => taskMocks);

const runDeployments = async (args: string[]): Promise<void> => {
  const command = createDeployDeploymentsCommand();
  await command.parseAsync(["node", "scai", ...args]);
};

describe("deploy deployments command actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs list/get/status actions", async () => {
    await runDeployments(["list", "--status", "Active"]);
    await runDeployments(["get", "--id", "dep-1"]);
    await runDeployments(["status"]);

    expect(taskMocks.runDeployDeploymentsList).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Active" })
    );
    expect(taskMocks.runDeployDeploymentsGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1" })
    );
    expect(taskMocks.runDeployDeploymentsStatus).toHaveBeenCalled();
  });

  it("runs deploy/cancel/source/logs/watch actions", async () => {
    await runDeployments(["deploy", "--id", "dep-1"]);
    await runDeployments(["cancel", "--id", "dep-1"]);
    await runDeployments(["source", "--id", "dep-1", "--file", "source.zip"]);
    await runDeployments(["logs", "--id", "dep-1", "--output", "logs.json"]);
    await runDeployments(["watch", "--id", "dep-1", "--wait-for-post-actions", "--timeout", "5"]);

    expect(taskMocks.runDeployDeploymentsDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1" })
    );
    expect(taskMocks.runDeployDeploymentsCancel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1" })
    );
    expect(taskMocks.runDeployDeploymentsSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1", file: "source.zip" })
    );
    expect(taskMocks.runDeployDeploymentLogs).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1", output: "logs.json" })
    );
    expect(taskMocks.runDeployDeploymentsWatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1", waitForPostActions: true, timeout: 5 })
    );
  });
});
