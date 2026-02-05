import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeployLogsCommand } from "../../../src/commands/deploy/logs";

const taskMocks = vi.hoisted(() => ({
  runDeployLogsList: vi.fn(),
  runDeployLogsView: vi.fn(),
  runDeployLogsData: vi.fn(),
}));

vi.mock("../../../src/serialization/tasks", () => taskMocks);

const runLogs = async (args: string[]): Promise<void> => {
  const command = createDeployLogsCommand();
  await command.parseAsync(["node", "scai", ...args]);
};

describe("deploy logs command actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs list action", async () => {
    await runLogs(["list", "--id", "env-1", "--latest"]);

    expect(taskMocks.runDeployLogsList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", latest: true })
    );
  });

  it("runs view and data actions", async () => {
    await runLogs(["view", "--id", "env-1", "--log", "app.log"]);
    await runLogs(["data", "--id", "env-1", "--log", "app.log", "--output", "out.log"]);

    expect(taskMocks.runDeployLogsView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", log: "app.log" })
    );
    expect(taskMocks.runDeployLogsData).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env-1", log: "app.log", output: "out.log" })
    );
  });
});
