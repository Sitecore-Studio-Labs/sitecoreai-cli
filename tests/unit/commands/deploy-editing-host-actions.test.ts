import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeployEditingHostCommand } from "../../../src/commands/deploy/editing-host";

const taskMocks = vi.hoisted(() => ({
  runDeployEditingHostList: vi.fn(),
  runDeployEditingHostCreate: vi.fn(),
  runDeployEditingHostDelete: vi.fn(),
  runDeployEditingHostUpdate: vi.fn(),
  runDeployEditingHostDeploy: vi.fn(),
}));

vi.mock("../../../src/serialization/tasks", () => taskMocks);

const runEditingHost = async (args: string[]): Promise<void> => {
  const command = createDeployEditingHostCommand();
  await command.parseAsync(["node", "scai", ...args]);
};

describe("deploy editing-host command actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs list/create/update/delete actions", async () => {
    await runEditingHost(["list", "--project", "proj-1"]);
    await runEditingHost(["create", "--cm-environment-id", "env-1", "--name", "EH"]);
    await runEditingHost(["update", "--id", "eh-1", "--name", "EH Updated"]);
    await runEditingHost(["delete", "--id", "eh-1", "--force"]);

    expect(taskMocks.runDeployEditingHostList).toHaveBeenCalledWith(
      expect.objectContaining({ project: "proj-1" })
    );
    expect(taskMocks.runDeployEditingHostCreate).toHaveBeenCalledWith(
      expect.objectContaining({ cmEnvironmentId: "env-1", name: "EH" })
    );
    expect(taskMocks.runDeployEditingHostUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "eh-1", name: "EH Updated" })
    );
    expect(taskMocks.runDeployEditingHostDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "eh-1", force: true })
    );
  });

  it("runs deploy action with wait options", async () => {
    await runEditingHost([
      "deploy",
      "--id",
      "eh-1",
      "--redeploy",
      "--no-watch",
      "--wait-for-post-actions",
      "--timeout",
      "10",
    ]);

    expect(taskMocks.runDeployEditingHostDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "eh-1",
        redeploy: true,
        waitForPostActions: true,
        timeout: 10,
      })
    );
  });
});
