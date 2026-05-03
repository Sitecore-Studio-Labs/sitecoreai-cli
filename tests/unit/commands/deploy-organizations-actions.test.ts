import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeployOrganizationsCommand } from "../../../src/commands/deploy/organizations";

const taskMocks = vi.hoisted(() => ({
  runDeployOrganizationsGet: vi.fn(),
  runDeployOrganizationsHealth: vi.fn(),
  runDeployOrganizationsLicense: vi.fn(),
  runDeployOrganizationsLaunchDemo: vi.fn(),
}));

vi.mock("../../../src/deploy/tasks", () => taskMocks);

const runOrganizations = async (args: string[]): Promise<void> => {
  const command = createDeployOrganizationsCommand();
  await command.parseAsync(["node", "scai", ...args]);
};

describe("deploy organizations command actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs organization actions", async () => {
    await runOrganizations(["get"]);
    await runOrganizations(["health"]);
    await runOrganizations(["license"]);
    await runOrganizations(["launch-demo"]);

    expect(taskMocks.runDeployOrganizationsGet).toHaveBeenCalled();
    expect(taskMocks.runDeployOrganizationsHealth).toHaveBeenCalled();
    expect(taskMocks.runDeployOrganizationsLicense).toHaveBeenCalled();
    expect(taskMocks.runDeployOrganizationsLaunchDemo).toHaveBeenCalled();
  });
});
