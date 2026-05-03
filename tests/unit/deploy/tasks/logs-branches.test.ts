import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const apiMocks = vi.hoisted(() => ({
  fetchLogList: vi.fn(),
  fetchLogFile: vi.fn(),
}));

vi.mock("../../../../src/deploy/api", () => ({
  ...apiMocks,
}));

const sharedMocks = vi.hoisted(() => ({
  getDeployContext: vi.fn(),
  inputError: (message: string) => new Error(message),
  printDeployResultWithContext: vi.fn(),
  resolveDeployEnvironmentId: vi.fn(),
  resolveDeployOrganizationId: vi.fn(),
  toLogger: vi.fn(),
}));

vi.mock("../../../../src/deploy/tasks/shared", () => sharedMocks);

describe("deploy logs branches", () => {
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
    sharedMocks.resolveDeployOrganizationId.mockResolvedValue("org-1");
    logger.isJson.mockReturnValue(false);
    apiMocks.fetchLogList.mockResolvedValue([{ fileName: "log.txt" }]);
    apiMocks.fetchLogFile.mockResolvedValue({ buffer: Buffer.from("log-data") });
  });

  afterEach(() => {
    logger.isJson.mockReset();
  });

  it("lists logs with latest flag and organization", async () => {
    const { runDeployLogsList } = await import("../../../../src/deploy/tasks/logs");
    await runDeployLogsList({ latest: true });
    expect(apiMocks.fetchLogList).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "env-1",
      true,
      "org-1"
    );
  });

  it("requires a log filename for view", async () => {
    const { runDeployLogsView } = await import("../../../../src/deploy/tasks/logs");
    await expect(runDeployLogsView({})).rejects.toThrow("Log filename is required. Use --log.");
  });

  it("prints logs as JSON when requested", async () => {
    logger.isJson.mockReturnValue(true);
    const { runDeployLogsView } = await import("../../../../src/deploy/tasks/logs");
    await runDeployLogsView({ log: "log.txt" });
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.logs.view",
      "log-data"
    );
  });

  it("writes log data to file and prints location", async () => {
    const { runDeployLogsData } = await import("../../../../src/deploy/tasks/logs");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-logs-"));
    const outputPath = path.join(dir, "log.txt");
    await runDeployLogsData({ log: "log.txt", output: outputPath });
    const content = await fs.readFile(outputPath, "utf8");
    expect(content).toBe("log-data");
    expect(logger.info).toHaveBeenCalledWith(`Saved log file to ${outputPath}`, "green");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes log data and returns JSON output", async () => {
    logger.isJson.mockReturnValue(true);
    const { runDeployLogsData } = await import("../../../../src/deploy/tasks/logs");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-logs-json-"));
    const outputPath = path.join(dir, "log.txt");
    await runDeployLogsData({ log: "log.txt", output: outputPath });
    expect(sharedMocks.printDeployResultWithContext).toHaveBeenCalledWith(
      logger,
      expect.objectContaining({ envName: "demo" }),
      "deploy.logs.data",
      null,
      { outputPath }
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});
