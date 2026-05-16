import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the list-or-mint reconciliation in `runSetupEnv`: fresh mint,
 * idempotent no-op, orphan re-mint, --rotate, --what-if, and the
 * input/auth guards. The config reader, keychain, and the clients-API
 * network calls are mocked; `buildScaiClientName` /
 * `buildScaiClientDescription` run for real.
 */
const mocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  getDeployToken: vi.fn(),
  getCmClientCredential: vi.fn(),
  setCmClientCredential: vi.fn().mockResolvedValue(true),
  listEnvironmentClients: vi.fn(),
  mintCmClient: vi.fn(),
  deleteClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: mocks.readRootConfiguration,
}));

vi.mock("../../../../src/shared/keychain", () => ({
  getDeployToken: mocks.getDeployToken,
  getCmClientCredential: mocks.getCmClientCredential,
  setCmClientCredential: mocks.setCmClientCredential,
}));

vi.mock("../../../../src/deploy/api", async (importActual) => {
  const actual = await importActual<typeof import("../../../../src/deploy/api")>();
  return {
    ...actual,
    listEnvironmentClients: mocks.listEnvironmentClients,
    mintCmClient: mocks.mintCmClient,
    deleteClient: mocks.deleteClient,
  };
});

const { runSetupEnv } = await import("../../../../src/serialization/tasks/env/setup-env");

const CONFIGURED_ENV = {
  organizationId: "org-1",
  projectId: "proj-1",
  environmentId: "env-1",
};

const baseOptions = { environmentName: "test", quiet: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setCmClientCredential.mockResolvedValue(true);
  mocks.deleteClient.mockResolvedValue(undefined);
  mocks.readRootConfiguration.mockReturnValue({
    environments: { test: { ...CONFIGURED_ENV } },
    brand: {},
  });
  mocks.getDeployToken.mockResolvedValue("deploy-token");
  mocks.getCmClientCredential.mockResolvedValue(undefined);
  mocks.listEnvironmentClients.mockResolvedValue({ items: [] });
  mocks.mintCmClient.mockResolvedValue({
    clientId: "minted-client-id",
    clientSecret: "minted-secret",
  });
  vi.stubEnv("SITECOREAI_DEPLOY_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runSetupEnv — guards", () => {
  it("rejects when no environment name is given", async () => {
    await expect(runSetupEnv({ quiet: true })).rejects.toThrow(/Environment name is required/);
  });

  it("rejects when the environment is not configured", async () => {
    mocks.readRootConfiguration.mockReturnValue({ environments: {}, brand: {} });
    await expect(runSetupEnv(baseOptions)).rejects.toThrow(/not configured/);
  });

  it("rejects when org/project/environment ids are missing", async () => {
    mocks.readRootConfiguration.mockReturnValue({
      environments: { test: { organizationId: "org-1" } },
      brand: {},
    });
    await expect(runSetupEnv(baseOptions)).rejects.toThrow(/missing organizationId/);
  });

  it("rejects with AUTH_REQUIRED when there is no deploy token", async () => {
    mocks.getDeployToken.mockResolvedValue(undefined);
    await expect(runSetupEnv(baseOptions)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("runSetupEnv — list-or-mint", () => {
  it("mints a fresh CM client when none exists", async () => {
    await runSetupEnv(baseOptions);
    expect(mocks.mintCmClient).toHaveBeenCalledTimes(1);
    expect(mocks.mintCmClient).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      expect.objectContaining({
        name: "scai-cm-test",
        projectId: "proj-1",
        environmentId: "env-1",
      }),
      "org-1"
    );
    expect(mocks.deleteClient).not.toHaveBeenCalled();
    expect(mocks.setCmClientCredential).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ clientId: "minted-client-id", clientSecret: "minted-secret" })
    );
  });

  it("is a no-op when the client is already provisioned", async () => {
    mocks.getCmClientCredential.mockResolvedValue({ clientId: "x", clientSecret: "y" });
    mocks.listEnvironmentClients.mockResolvedValue({
      items: [{ id: "client-1", name: "scai-cm-test" }],
    });
    await runSetupEnv(baseOptions);
    expect(mocks.mintCmClient).not.toHaveBeenCalled();
    expect(mocks.deleteClient).not.toHaveBeenCalled();
  });

  it("deletes and re-mints an orphan (server client, no stored secret)", async () => {
    mocks.getCmClientCredential.mockResolvedValue(undefined);
    mocks.listEnvironmentClients.mockResolvedValue({
      items: [{ id: "orphan-1", name: "scai-cm-test" }],
    });
    await runSetupEnv(baseOptions);
    expect(mocks.deleteClient).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "orphan-1",
      "org-1"
    );
    expect(mocks.mintCmClient).toHaveBeenCalledTimes(1);
  });

  it("--rotate deletes and re-mints even when already provisioned", async () => {
    mocks.getCmClientCredential.mockResolvedValue({ clientId: "x", clientSecret: "y" });
    mocks.listEnvironmentClients.mockResolvedValue({
      items: [{ id: "client-1", name: "scai-cm-test" }],
    });
    await runSetupEnv({ ...baseOptions, rotate: true });
    expect(mocks.deleteClient).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "client-1",
      "org-1"
    );
    expect(mocks.mintCmClient).toHaveBeenCalledTimes(1);
  });
});

describe("runSetupEnv — what-if", () => {
  it("mints nothing under --what-if", async () => {
    await runSetupEnv({ ...baseOptions, whatIf: true });
    expect(mocks.mintCmClient).not.toHaveBeenCalled();
    expect(mocks.deleteClient).not.toHaveBeenCalled();
    expect(mocks.setCmClientCredential).not.toHaveBeenCalled();
  });

  it("still reads the existing client list under --what-if", async () => {
    await runSetupEnv({ ...baseOptions, whatIf: true });
    expect(mocks.listEnvironmentClients).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "org-1"
    );
  });
});
