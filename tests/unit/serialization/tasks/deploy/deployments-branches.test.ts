import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const apiMocks = vi.hoisted(() => ({
  fetchDeployment: vi.fn(),
  fetchDeploymentV3: vi.fn(),
  fetchDeploymentStatus: vi.fn(),
  fetchDeployments: vi.fn(),
  deployDeployment: vi.fn(),
  cancelDeployment: vi.fn(),
  uploadDeploymentSource: vi.fn(),
  fetchDeploymentLogs: vi.fn(),
}));

vi.mock("../../../../../src/deploy/api", () => ({
  ...apiMocks,
}));

const sharedMocks = vi.hoisted(() => ({
  getDeployContext: vi.fn(),
  inputError: (message: string) => new Error(message),
  printDeployResultWithContext: vi.fn(),
  printDeployWhatIf: vi.fn(),
  resolveDeployOrganizationId: vi.fn(),
  toLogger: vi.fn(),
}));

vi.mock("../../../../../src/serialization/tasks/shared", () => sharedMocks);

describe("deploy deployments branches", () => {
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
    sharedMocks.resolveDeployOrganizationId.mockResolvedValue("org-1");
    logger.isJson.mockReturnValue(false);
  });

  it("prints what-if for deployments deploy and cancel", async () => {
    const { runDeployDeploymentsDeploy, runDeployDeploymentsCancel } =
      await import("../../../../../src/serialization/tasks/deploy/deployments");
    await runDeployDeploymentsDeploy({ id: "dep-1", whatIf: true });
    await runDeployDeploymentsCancel({ id: "dep-1", whatIf: true });
    expect(sharedMocks.printDeployWhatIf).toHaveBeenCalledTimes(2);
    expect(apiMocks.deployDeployment).not.toHaveBeenCalled();
    expect(apiMocks.cancelDeployment).not.toHaveBeenCalled();
  });

  it("streams deployment logs to output when json", async () => {
    logger.isJson.mockReturnValue(true);
    apiMocks.fetchDeploymentLogs.mockResolvedValue({ logs: ["line"] });
    const { runDeployDeploymentLogs } =
      await import("../../../../../src/serialization/tasks/deploy/deployments");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-deploy-logs-"));
    const outputPath = path.join(dir, "logs.json");
    await runDeployDeploymentLogs({ id: "dep-1", output: outputPath });
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.deployments.logs",
      null,
      { outputPath }
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("watches deployments in what-if mode", async () => {
    apiMocks.fetchDeploymentV3.mockResolvedValue({ calculatedStatus: 1 });
    const { runDeployDeploymentsWatch } =
      await import("../../../../../src/serialization/tasks/deploy/deployments");
    await runDeployDeploymentsWatch({ id: "dep-1", whatIf: true });
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.deployments.watch",
      expect.any(Object),
      { whatIf: true }
    );
  });

  it("times out deployment watch when duration exceeded", async () => {
    vi.useFakeTimers();
    apiMocks.fetchDeploymentV3.mockResolvedValue({
      calculatedStatus: 1,
      deploymentStatus: 1,
      postActionStatus: 1,
    });
    const { runDeployDeploymentsWatch } =
      await import("../../../../../src/serialization/tasks/deploy/deployments");
    const promise = runDeployDeploymentsWatch({ id: "dep-1", timeout: 1 });
    const rejection = expect(promise).rejects.toThrow(
      "Deployment watch timed out after 1 seconds."
    );
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    vi.useRealTimers();
  });

  it("validates source inputs and uploads a directory", async () => {
    const { runDeployDeploymentsSource } =
      await import("../../../../../src/serialization/tasks/deploy/deployments");
    await expect(
      runDeployDeploymentsSource({ id: "dep-1", file: "a.zip", directory: "dir" })
    ).rejects.toThrow("Use either --file or --directory, not both.");
    await expect(runDeployDeploymentsSource({ id: "dep-1" })).rejects.toThrow(
      "Source file is required. Use --file or --directory."
    );

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-deploy-src-"));
    await fs.writeFile(path.join(dir, "file.txt"), "content", "utf8");
    await runDeployDeploymentsSource({ id: "dep-1", directory: dir });
    expect(apiMocks.uploadDeploymentSource).toHaveBeenCalled();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects directory when file is expected", async () => {
    const { runDeployDeploymentsSource } =
      await import("../../../../../src/serialization/tasks/deploy/deployments");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-deploy-file-"));
    await expect(runDeployDeploymentsSource({ id: "dep-1", file: dir })).rejects.toThrow(
      "File path must point to a file. Use --directory to zip a folder."
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});
