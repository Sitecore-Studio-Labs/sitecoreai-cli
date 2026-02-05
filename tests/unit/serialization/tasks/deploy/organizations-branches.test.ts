import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchOrganization: vi.fn(),
  fetchOrganizationHealth: vi.fn(),
  fetchOrganizationLicense: vi.fn(),
  createOrganizationDemoSolution: vi.fn(),
}));

vi.mock("../../../../../src/deploy/api", () => ({
  ...apiMocks,
}));

const sharedMocks = vi.hoisted(() => ({
  getDeployContext: vi.fn(),
  inputError: (message: string) => new Error(message),
  printDeployResultWithContext: vi.fn(),
  resolveDeployOrganizationId: vi.fn(),
  toLogger: vi.fn(),
}));

vi.mock("../../../../../src/serialization/tasks/shared", () => sharedMocks);

describe("deploy organizations branches", () => {
  const logger = {
    info: vi.fn(),
    isJson: vi.fn(),
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
  });

  it("throws when organization id is missing for health", async () => {
    sharedMocks.resolveDeployOrganizationId.mockResolvedValue(undefined);
    const { runDeployOrganizationsHealth } =
      await import("../../../../../src/serialization/tasks/deploy/organizations");
    await expect(runDeployOrganizationsHealth({})).rejects.toThrow(
      "Organization ID is required. Run init or pass --organization-id."
    );
  });

  it("throws when organization id is missing for license", async () => {
    sharedMocks.resolveDeployOrganizationId.mockResolvedValue(undefined);
    const { runDeployOrganizationsLicense } =
      await import("../../../../../src/serialization/tasks/deploy/organizations");
    await expect(runDeployOrganizationsLicense({})).rejects.toThrow(
      "Organization ID is required. Run init or pass --organization-id."
    );
  });

  it("throws when organization id is missing for launch demo", async () => {
    sharedMocks.resolveDeployOrganizationId.mockResolvedValue(undefined);
    const { runDeployOrganizationsLaunchDemo } =
      await import("../../../../../src/serialization/tasks/deploy/organizations");
    await expect(runDeployOrganizationsLaunchDemo({})).rejects.toThrow(
      "Organization ID is required. Run init or pass --organization-id."
    );
  });

  it("fetches organization details", async () => {
    const { runDeployOrganizationsGet } =
      await import("../../../../../src/serialization/tasks/deploy/organizations");
    await runDeployOrganizationsGet({});
    expect(apiMocks.fetchOrganization).toHaveBeenCalledWith({
      accessToken: "token",
      baseUrl: "https://api.example",
    });
  });
});
