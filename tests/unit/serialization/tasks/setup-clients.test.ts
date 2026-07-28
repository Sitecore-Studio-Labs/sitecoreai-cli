import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScaiError } from "../../../../src/shared/errors";

/**
 * Covers `runSetupClients`: the input/auth guards and that it lists both
 * the environment-scoped and organization-scoped clients for the
 * resolved organization. Config, keychain, and the clients-API calls are
 * mocked.
 *
 * Env resolution lives in `resolveActiveEnvironment` (covered in
 * tests/unit/config/resolve-active-environment.test.ts); here it is
 * mocked.
 */
const mocks = vi.hoisted(() => ({
  resolveActiveEnvironment: vi.fn(),
  readRootConfigurationFile: vi.fn(),
  writeRootConfigurationFile: vi.fn(),
  getDeployToken: vi.fn(),
  clearCmClientSecret: vi.fn().mockResolvedValue(true),
  clearOrgClientSecret: vi.fn().mockResolvedValue(true),
  listEnvironmentClients: vi.fn(),
  listOrganizationClients: vi.fn(),
  deleteClient: vi.fn().mockResolvedValue(undefined),
  confirmDestructive: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  resolveActiveEnvironment: mocks.resolveActiveEnvironment,
  readRootConfigurationFile: mocks.readRootConfigurationFile,
  writeRootConfigurationFile: mocks.writeRootConfigurationFile,
}));

vi.mock("../../../../src/shared/keychain", () => ({
  getDeployToken: mocks.getDeployToken,
  clearCmClientSecret: mocks.clearCmClientSecret,
  clearOrgClientSecret: mocks.clearOrgClientSecret,
}));

vi.mock("../../../../src/deploy/api", async (importActual) => {
  const actual = await importActual<typeof import("../../../../src/deploy/api")>();
  return {
    ...actual,
    listEnvironmentClients: mocks.listEnvironmentClients,
    listOrganizationClients: mocks.listOrganizationClients,
    deleteClient: mocks.deleteClient,
  };
});

vi.mock("../../../../src/shared/cli-tasks", async (importActual) => {
  const actual = await importActual<typeof import("../../../../src/shared/cli-tasks")>();
  return { ...actual, confirmDestructive: mocks.confirmDestructive };
});

const { runSetupClients } = await import("../../../../src/setup/setup-clients");

const baseOptions = { environmentName: "test", quiet: true };

/** A resolved-environment result as `resolveActiveEnvironment` returns it. */
const resolved = (
  env: Record<string, unknown> = { organizationId: "org-1" }
): { envName: string; env: Record<string, unknown>; root: Record<string, unknown> } => ({
  envName: "test",
  env,
  root: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveActiveEnvironment.mockReturnValue(resolved());
  mocks.readRootConfigurationFile.mockReturnValue({ config: {} });
  mocks.getDeployToken.mockResolvedValue("deploy-token");
  mocks.clearCmClientSecret.mockResolvedValue(true);
  mocks.clearOrgClientSecret.mockResolvedValue(true);
  mocks.deleteClient.mockResolvedValue(undefined);
  mocks.confirmDestructive.mockResolvedValue(true);
  mocks.listEnvironmentClients.mockResolvedValue({
    items: [{ id: "c-1", name: "scai-cm-test", clientId: "cid-1", environmentName: "test" }],
  });
  mocks.listOrganizationClients.mockResolvedValue({
    items: [{ id: "c-2", name: "hand-made-client", clientId: "cid-2" }],
  });
  vi.stubEnv("SITECOREAI_DEPLOY_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runSetupClients — guards", () => {
  it("propagates env-resolution failures from resolveActiveEnvironment", async () => {
    mocks.resolveActiveEnvironment.mockImplementation(() => {
      throw new ScaiError("No environment specified and no defaultEnvProfile is set.", {
        code: "INPUT_INVALID",
      });
    });
    await expect(runSetupClients({ quiet: true })).rejects.toThrow(/No environment specified/);
  });

  it("rejects when the environment has no organizationId", async () => {
    mocks.resolveActiveEnvironment.mockReturnValue(resolved({}));
    await expect(runSetupClients(baseOptions)).rejects.toThrow(/no organizationId/);
  });

  it("rejects with AUTH_REQUIRED when there is no deploy token", async () => {
    mocks.getDeployToken.mockResolvedValue(undefined);
    await expect(runSetupClients(baseOptions)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("runSetupClients — listing", () => {
  it("lists both environment- and organization-scoped clients for the org", async () => {
    await runSetupClients(baseOptions);
    expect(mocks.listEnvironmentClients).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "org-1"
    );
    expect(mocks.listOrganizationClients).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "org-1"
    );
  });

  it("resolves the environment via resolveActiveEnvironment when no name is passed", async () => {
    await runSetupClients({ quiet: true });
    expect(mocks.resolveActiveEnvironment).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(mocks.listEnvironmentClients).toHaveBeenCalledTimes(1);
  });

  it("runs the JSON output path without error", async () => {
    await expect(
      runSetupClients({ ...baseOptions, json: true, quiet: false })
    ).resolves.toBeUndefined();
    expect(mocks.listEnvironmentClients).toHaveBeenCalled();
    expect(mocks.listOrganizationClients).toHaveBeenCalled();
  });
});

describe("runSetupClients — delete", () => {
  it("rejects when the id is not found in the org", async () => {
    await expect(runSetupClients({ ...baseOptions, delete: "nope" })).rejects.toThrow(
      /No client with id/
    );
    expect(mocks.deleteClient).not.toHaveBeenCalled();
  });

  it("confirms then deletes the client by id", async () => {
    await runSetupClients({ ...baseOptions, delete: "c-1" });
    expect(mocks.confirmDestructive).toHaveBeenCalled();
    expect(mocks.deleteClient).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "c-1",
      "org-1"
    );
  });

  it("does not delete when confirmation is declined", async () => {
    mocks.confirmDestructive.mockResolvedValue(false);
    await runSetupClients({ ...baseOptions, delete: "c-1" });
    expect(mocks.deleteClient).not.toHaveBeenCalled();
  });

  it("clears the keychain CM secret when deleting this env's scai cm client", async () => {
    await runSetupClients({ ...baseOptions, delete: "c-1" });
    expect(mocks.clearCmClientSecret).toHaveBeenCalledWith("test");
  });

  it("does not clear the keychain when deleting a non-scai client", async () => {
    await runSetupClients({ ...baseOptions, delete: "c-2" });
    expect(mocks.deleteClient).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "c-2",
      "org-1"
    );
    expect(mocks.clearCmClientSecret).not.toHaveBeenCalled();
    expect(mocks.clearOrgClientSecret).not.toHaveBeenCalled();
  });

  it("forwards --force to confirmDestructive", async () => {
    await runSetupClients({ ...baseOptions, delete: "c-1", force: true });
    expect(mocks.confirmDestructive).toHaveBeenCalledWith(expect.any(String), true);
  });
});
