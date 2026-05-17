import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScaiError } from "../../../../src/shared/errors";

/**
 * Covers the list-or-mint reconciliation in `runSetupEnv`: fresh mint,
 * idempotent no-op, orphan re-mint, --rotate, --what-if, and the
 * input/auth guards. The config reader/writer, keychain, and the
 * clients-API network calls are mocked; `buildScaiClientName` /
 * `buildScaiClientDescription` run for real.
 *
 * Env resolution lives in `resolveActiveEnvironment` (covered in
 * tests/unit/config/resolve-active-environment.test.ts); here it is
 * mocked. Per `docs/credentials.md` a provisioned env client means both
 * halves agree: the `automationClient` metadata in the config AND the
 * secret in the keychain. A mint writes the metadata to the config (via
 * `writeRootConfigurationFile`) and only the secret to the keychain.
 */
const mocks = vi.hoisted(() => ({
  resolveActiveEnvironment: vi.fn(),
  readRootConfigurationFile: vi.fn(),
  writeRootConfigurationFile: vi.fn(),
  getDeployToken: vi.fn(),
  getCmClientSecret: vi.fn(),
  setCmClientSecret: vi.fn().mockResolvedValue(true),
  listEnvironmentClients: vi.fn(),
  mintCmClient: vi.fn(),
  deleteClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/config/root-config", () => ({
  resolveActiveEnvironment: mocks.resolveActiveEnvironment,
  readRootConfigurationFile: mocks.readRootConfigurationFile,
  writeRootConfigurationFile: mocks.writeRootConfigurationFile,
}));

vi.mock("../../../../src/shared/keychain", () => ({
  getDeployToken: mocks.getDeployToken,
  getCmClientSecret: mocks.getCmClientSecret,
  setCmClientSecret: mocks.setCmClientSecret,
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

/** A resolved-environment result as `resolveActiveEnvironment` returns it. */
const resolved = (
  env: Record<string, unknown> = { ...CONFIGURED_ENV }
): { envName: string; env: Record<string, unknown>; root: Record<string, unknown> } => ({
  envName: "test",
  env,
  root: { physicalPath: "/proj/sitecoreai.cli.json", environments: { test: env }, brand: {} },
});

/** A fresh root-config-file mock value with the `test` env profile. */
const configFile = (
  envOverrides: Record<string, unknown> = {}
): { config: { envProfiles: Record<string, Record<string, unknown>> } } => ({
  config: {
    envProfiles: { test: { ...CONFIGURED_ENV, ...envOverrides } },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setCmClientSecret.mockResolvedValue(true);
  mocks.deleteClient.mockResolvedValue(undefined);
  mocks.resolveActiveEnvironment.mockReturnValue(resolved());
  mocks.readRootConfigurationFile.mockReturnValue(configFile());
  mocks.getDeployToken.mockResolvedValue("deploy-token");
  mocks.getCmClientSecret.mockResolvedValue(undefined);
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
  it("propagates env-resolution failures from resolveActiveEnvironment", async () => {
    mocks.resolveActiveEnvironment.mockImplementation(() => {
      throw new ScaiError("No environment specified and no defaultEnvProfile is set.", {
        code: "INPUT_INVALID",
      });
    });
    await expect(runSetupEnv({ quiet: true })).rejects.toThrow(/no defaultEnvProfile is set/);
  });

  it("rejects when org/project/environment ids are missing", async () => {
    mocks.resolveActiveEnvironment.mockReturnValue(resolved({ organizationId: "org-1" }));
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
    // Only the secret goes to the keychain.
    expect(mocks.setCmClientSecret).toHaveBeenCalledWith("test", "minted-secret");
    // The non-secret metadata is written into the env profile's
    // `automationClient` block in the config file.
    expect(mocks.writeRootConfigurationFile).toHaveBeenCalledTimes(1);
    const written = mocks.writeRootConfigurationFile.mock.calls[0][1] as {
      envProfiles: Record<string, { automationClient?: Record<string, unknown> }>;
    };
    expect(written.envProfiles.test.automationClient).toEqual(
      expect.objectContaining({ clientId: "minted-client-id", name: "scai-cm-test" })
    );
  });

  it("is a no-op when the client is already provisioned", async () => {
    // Both halves present: config metadata + keychain secret.
    mocks.resolveActiveEnvironment.mockReturnValue(
      resolved({ ...CONFIGURED_ENV, automationClient: { clientId: "x" } })
    );
    mocks.getCmClientSecret.mockResolvedValue("y");
    mocks.listEnvironmentClients.mockResolvedValue({
      items: [{ id: "client-1", name: "scai-cm-test" }],
    });
    await runSetupEnv(baseOptions);
    expect(mocks.mintCmClient).not.toHaveBeenCalled();
    expect(mocks.deleteClient).not.toHaveBeenCalled();
  });

  it("deletes and re-mints an orphan (server client, no stored secret)", async () => {
    mocks.getCmClientSecret.mockResolvedValue(undefined);
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
    mocks.resolveActiveEnvironment.mockReturnValue(
      resolved({ ...CONFIGURED_ENV, automationClient: { clientId: "x" } })
    );
    mocks.getCmClientSecret.mockResolvedValue("y");
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
    expect(mocks.setCmClientSecret).not.toHaveBeenCalled();
    expect(mocks.writeRootConfigurationFile).not.toHaveBeenCalled();
  });

  it("still reads the existing client list under --what-if", async () => {
    await runSetupEnv({ ...baseOptions, whatIf: true });
    expect(mocks.listEnvironmentClients).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "org-1"
    );
  });
});
