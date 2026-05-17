/**
 * Branch coverage for `serialization env status` (`runStatus`).
 *
 * Mirrors the mocking in `../env.test.ts` but drills into the
 * `cmAuth` resolution matrix, the `hasConfig` "empty profile" gate,
 * the deploy-token freshness warning, and the credential-matrix
 * presence reporting — across both JSON and text output modes.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RootConfigurationFile } from "../../../../../src/config/types";

const mocks = vi.hoisted(() => ({
  readRootConfigurationFile: vi.fn(),
  readRootConfiguration: vi.fn(),
  getCmTokens: vi.fn(),
  getDeployToken: vi.fn(),
  getCmClientSecret: vi.fn(),
  getOrgClientSecret: vi.fn(),
  logger: {
    isJson: vi.fn(),
    json: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const {
  readRootConfigurationFile,
  readRootConfiguration,
  getCmTokens,
  getDeployToken,
  getCmClientSecret,
  getOrgClientSecret,
  logger,
} = mocks;

vi.mock("../../../../../src/config/root-config", () => ({
  readRootConfigurationFile: mocks.readRootConfigurationFile,
  readRootConfiguration: mocks.readRootConfiguration,
  writeRootConfigurationFile: vi.fn(),
}));

vi.mock("../../../../../src/shared/keychain", () => ({
  getCmTokens: mocks.getCmTokens,
  getDeployToken: mocks.getDeployToken,
  getCmClientSecret: mocks.getCmClientSecret,
  getOrgClientSecret: mocks.getOrgClientSecret,
  clearCmTokens: vi.fn(),
  clearDeployToken: vi.fn(),
  setDeployToken: vi.fn(),
  setCmTokens: vi.fn(),
}));

vi.mock("../../../../../src/serialization/tasks/shared", () => ({
  applyIfDefined: vi.fn(),
  getEnvironmentType: vi.fn(),
  resolveProjectIdValue: vi.fn(),
  selectFromList: vi.fn(),
  selectMatch: vi.fn(),
  toLogger: () => mocks.logger,
}));

import { runStatus } from "../../../../../src/serialization/tasks/env/status";

const installConfig = (file: RootConfigurationFile, environments: Record<string, unknown> = {}) => {
  readRootConfigurationFile.mockReturnValue(file);
  readRootConfiguration.mockReturnValue({
    environments,
    brand: {},
    orgClients: {},
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  getCmTokens.mockResolvedValue(undefined);
  getDeployToken.mockResolvedValue(undefined);
  getCmClientSecret.mockResolvedValue(undefined);
  getOrgClientSecret.mockResolvedValue(undefined);
});

describe("runStatus — cmAuth resolution matrix (JSON mode)", () => {
  beforeEach(() => {
    logger.isJson.mockReturnValue(true);
  });

  it("reports cmAuth='keychain' when cached CM tokens exist", async () => {
    installConfig({
      config: { defaultEnvProfile: "demo", envProfiles: { demo: { host: "h" } } },
    });
    getCmTokens.mockResolvedValue({ accessToken: "tok" });

    await runStatus({ config: "/tmp", json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        envProfiles: [expect.objectContaining({ name: "demo", cmAuth: "keychain" })],
      })
    );
  });

  it("reports cmAuth='cached' when only the profile carries a token", async () => {
    installConfig({
      config: {
        defaultEnvProfile: "demo",
        envProfiles: { demo: { host: "h", accessToken: "inline" } },
      },
    });

    await runStatus({ config: "/tmp", json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        envProfiles: [expect.objectContaining({ cmAuth: "cached" })],
      })
    );
  });

  it("reports cmAuth='disabled' when token caching is turned off", async () => {
    installConfig({
      config: {
        defaultEnvProfile: "demo",
        envProfiles: { demo: { host: "h", cacheAuthenticationToken: false } },
      },
    });

    await runStatus({ config: "/tmp", json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        envProfiles: [expect.objectContaining({ cmAuth: "disabled" })],
      })
    );
    // cacheAuthenticationToken:false skips the keychain read entirely.
    expect(getCmTokens).not.toHaveBeenCalled();
  });

  it("reports cmAuth='missing' when no token source is configured", async () => {
    installConfig({
      config: { defaultEnvProfile: "demo", envProfiles: { demo: { host: "h" } } },
    });

    await runStatus({ config: "/tmp", json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        envProfiles: [expect.objectContaining({ cmAuth: "missing" })],
      })
    );
  });

  it("reports cmAuth='client-credentials (incomplete)' when useClientCredentials but no client", async () => {
    installConfig({
      config: {
        defaultEnvProfile: "demo",
        envProfiles: { demo: { host: "h", useClientCredentials: true } },
      },
    });

    await runStatus({ config: "/tmp", json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        envProfiles: [expect.objectContaining({ cmAuth: "client-credentials (incomplete)" })],
      })
    );
  });

  it("reports cmAuth='client-credentials' when a BYO client is wired up", async () => {
    installConfig(
      {
        config: {
          defaultEnvProfile: "demo",
          envProfiles: {
            demo: {
              host: "h",
              useClientCredentials: true,
              clientId: "byo-client",
            },
          },
        },
      },
      { demo: { useClientCredentials: true, clientId: "byo-client" } }
    );

    await runStatus({ config: "/tmp", json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        envProfiles: [expect.objectContaining({ cmAuth: "client-credentials" })],
      })
    );
  });
});

describe("runStatus — JSON mode envelope shape", () => {
  it("threads ids, deploy-token metadata, and credentials into the JSON envelope", async () => {
    const demoProfile = {
      host: "https://cm",
      authority: "https://auth",
      ref: "main",
      environmentType: "cm",
      organizationId: "org-1",
      tenantId: "ten-1",
      projectId: "proj-1",
      environmentId: "env-1",
      editingHostEnvironmentIds: ["eh-1", "eh-2"],
      allowWrite: true,
      deployTokenExpiresIn: 3600,
      deployTokenLastUpdated: "2026-05-01T00:00:00Z",
    };
    installConfig(
      {
        config: { defaultEnvProfile: "demo", envProfiles: { demo: demoProfile } },
      },
      { demo: demoProfile }
    );
    getDeployToken.mockResolvedValue("deploy-tok");
    logger.isJson.mockReturnValue(true);

    await runStatus({ config: "/tmp", json: true });

    const envelope = logger.json.mock.calls[0][0] as {
      defaultEnvProfile: string;
      envProfiles: Array<Record<string, unknown>>;
    };
    expect(envelope.defaultEnvProfile).toBe("demo");
    const profile = envelope.envProfiles[0];
    expect(profile.isDefault).toBe(true);
    expect(profile.deployToken).toBe(true);
    expect(profile.deployTokenExpiresIn).toBe(3600);
    expect(profile.editingHostEnvironmentIds).toEqual(["eh-1", "eh-2"]);
    expect(profile.ids).toEqual({
      organizationId: "org-1",
      tenantId: "ten-1",
      projectId: "proj-1",
      environmentId: "env-1",
    });
    expect(profile.credentials).toEqual(
      expect.objectContaining({ envClient: expect.any(Boolean) })
    );
  });

  it("sorts env profiles alphabetically and excludes the reserved 'default' name", async () => {
    installConfig({
      config: {
        defaultEnvProfile: "zeta",
        envProfiles: {
          zeta: { host: "z" },
          alpha: { host: "a" },
          default: { host: "ignored" },
        },
      },
    });
    logger.isJson.mockReturnValue(true);

    await runStatus({ config: "/tmp", json: true });

    const envelope = logger.json.mock.calls[0][0] as {
      envProfiles: Array<{ name: string }>;
    };
    expect(envelope.envProfiles.map((p) => p.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("runStatus — text mode branches", () => {
  beforeEach(() => {
    logger.isJson.mockReturnValue(false);
  });

  it("marks an env with no configuration as 'empty (not configured)'", async () => {
    installConfig({
      config: { defaultEnvProfile: "blank", envProfiles: { blank: {} } },
    });

    await runStatus({ config: "/tmp" });

    expect(logger.warn).toHaveBeenCalledWith("\nblank (default)", "yellow");
    expect(logger.info).toHaveBeenCalledWith("  status: empty (not configured)");
  });

  it("prints host, ids, editing hosts and credential marks for a configured env", async () => {
    const prodProfile = {
      host: "https://prod",
      authority: "https://auth",
      ref: "release",
      environmentType: "cm",
      organizationId: "org-x",
      editingHostEnvironmentIds: ["eh-9"],
      allowWrite: true,
    };
    installConfig(
      {
        config: { defaultEnvProfile: "prod", envProfiles: { prod: prodProfile } },
      },
      { prod: prodProfile }
    );

    await runStatus({ config: "/tmp" });

    expect(logger.info).toHaveBeenCalledWith("\nprod (default)", "green");
    expect(logger.info).toHaveBeenCalledWith("  host: https://prod");
    expect(logger.info).toHaveBeenCalledWith("  ref: release");
    expect(logger.info).toHaveBeenCalledWith("  environmentType: cm");
    expect(logger.info).toHaveBeenCalledWith("  ids:");
    expect(logger.info).toHaveBeenCalledWith("    organizationId: org-x");
    expect(logger.info).toHaveBeenCalledWith("  editingHostEnvironmentIds:");
    expect(logger.info).toHaveBeenCalledWith("    eh-9");
    expect(logger.info).toHaveBeenCalledWith("  allowWrite: true");
    expect(logger.info).toHaveBeenCalledWith("  credentials:");
    expect(logger.info).toHaveBeenCalledWith("    env client: missing");
  });

  it("does not warn about an expiring deploy token when it has plenty of life left", async () => {
    const lastUpdated = new Date().toISOString();
    installConfig({
      config: {
        defaultEnvProfile: "demo",
        envProfiles: {
          demo: {
            host: "h",
            deployToken: "tok",
            deployTokenExpiresIn: 86400,
            deployTokenLastUpdated: lastUpdated,
          },
        },
      },
    });

    await runStatus({ config: "/tmp" });

    expect(logger.warn).not.toHaveBeenCalledWith("  deployToken: expiring soon", "yellow");
    expect(logger.info).toHaveBeenCalledWith("  deployToken: set");
  });

  it("warns when the deploy token is about to expire", async () => {
    installConfig({
      config: {
        defaultEnvProfile: "demo",
        envProfiles: {
          demo: {
            host: "h",
            deployToken: "tok",
            deployTokenExpiresIn: 60,
            deployTokenLastUpdated: new Date().toISOString(),
          },
        },
      },
    });

    await runStatus({ config: "/tmp" });

    expect(logger.warn).toHaveBeenCalledWith("  deployToken: expiring soon", "yellow");
  });

  it("ignores an unparseable deployTokenLastUpdated without throwing", async () => {
    installConfig({
      config: {
        defaultEnvProfile: "demo",
        envProfiles: {
          demo: {
            host: "h",
            deployToken: "tok",
            deployTokenExpiresIn: 60,
            deployTokenLastUpdated: "not-a-date",
          },
        },
      },
    });

    await runStatus({ config: "/tmp" });

    // Unparseable date → Date.parse is NaN → no warning, no crash.
    expect(logger.warn).not.toHaveBeenCalledWith("  deployToken: expiring soon", "yellow");
  });

  it("reports a missing deploy token as 'missing'", async () => {
    installConfig({
      config: { defaultEnvProfile: "demo", envProfiles: { demo: { host: "h" } } },
    });

    await runStatus({ config: "/tmp" });

    expect(logger.info).toHaveBeenCalledWith("  deployToken: missing");
  });

  it("treats a profile with only variables as configured (not empty)", async () => {
    installConfig({
      config: {
        defaultEnvProfile: "demo",
        envProfiles: { demo: { variables: { FOO: "bar" } } },
      },
    });

    await runStatus({ config: "/tmp" });

    expect(logger.info).not.toHaveBeenCalledWith("  status: empty (not configured)");
    expect(logger.info).toHaveBeenCalledWith("\ndemo (default)", "green");
  });

  it("warns when no environments are configured at all", async () => {
    installConfig({
      config: { defaultEnvProfile: undefined, envProfiles: {} },
    });

    await runStatus({ config: "/tmp" });

    expect(logger.info).toHaveBeenCalledWith("Default environment: (not set)", "cyan");
    expect(logger.warn).toHaveBeenCalledWith(
      "No environments are configured. Use the init command to add one."
    );
  });

  it("falls back to process.cwd() when no --config is supplied", async () => {
    installConfig({
      config: { defaultEnvProfile: "demo", envProfiles: {} },
    });

    await runStatus({});

    expect(readRootConfigurationFile).toHaveBeenCalledWith(process.cwd());
  });
});

describe("runStatus — credential marks reflect resolved presence", () => {
  it("marks env client 'ok' when the minted client metadata + secret are both present", async () => {
    installConfig(
      {
        config: {
          defaultEnvProfile: "demo",
          envProfiles: {
            demo: { host: "h", organizationId: "org-1" },
          },
        },
      },
      { demo: { host: "h", organizationId: "org-1", automationClient: { clientId: "c1" } } }
    );
    getCmClientSecret.mockResolvedValue("the-secret");
    logger.isJson.mockReturnValue(false);

    await runStatus({ config: "/tmp" });

    expect(logger.info).toHaveBeenCalledWith("    env client: ok");
  });
});
