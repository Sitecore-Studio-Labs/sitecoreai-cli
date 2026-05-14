import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RootConfigurationFile } from "../../../../src/config";

const readRootConfigurationFile = vi.fn();
const readRootConfiguration = vi.fn();
const writeRootConfigurationFile = vi.fn();

vi.mock("../../../../src/config", () => ({
  readRootConfigurationFile,
  readRootConfiguration,
  writeRootConfigurationFile,
}));

const getCmTokens = vi.fn();
const getDeployToken = vi.fn();
const clearCmTokens = vi.fn();
const clearDeployToken = vi.fn();
const setDeployToken = vi.fn();
const setCmTokens = vi.fn().mockResolvedValue(true);

vi.mock("../../../../src/shared/keychain", () => ({
  getCmTokens,
  getDeployToken,
  clearCmTokens,
  clearDeployToken,
  setDeployToken,
  setCmTokens,
}));

const requestClientCredentialsToken = vi.fn();

vi.mock("../../../../src/serialization/sitecore-api", () => ({
  requestClientCredentialsToken,
  requestDeviceAuthorization: vi.fn(),
  pollDeviceToken: vi.fn(),
}));

const logger = {
  isJson: vi.fn(),
  json: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

vi.mock("../../../../src/serialization/tasks/shared", () => ({
  applyIfDefined: vi.fn(),
  getEnvironmentType: vi.fn(),
  resolveProjectIdValue: vi.fn(),
  selectFromList: vi.fn(),
  selectMatch: vi.fn(),
  toLogger: () => logger,
}));

describe("serialization env tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs status in JSON mode", async () => {
    const { runStatus } = await import("../../../../src/serialization/tasks/env");
    const configFile: RootConfigurationFile = {
      config: {
        defaultEnvProfile: "demo",
        envProfiles: {
          demo: {
            host: "https://cm.example",
            allowWrite: true,
          },
        },
      },
    };
    readRootConfigurationFile.mockReturnValue(configFile);
    readRootConfiguration.mockReturnValue({ environments: {} });
    getCmTokens.mockResolvedValue({ accessToken: "token" });
    getDeployToken.mockResolvedValue("deploy");
    logger.isJson.mockReturnValue(true);

    await runStatus({ config: "/tmp", json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultEnvProfile: "demo",
        envProfiles: [
          expect.objectContaining({
            name: "demo",
            isDefault: true,
            host: "https://cm.example",
            deployToken: true,
            allowWrite: true,
          }),
        ],
      })
    );
  });

  it("runs status in text mode with reserved default warnings", async () => {
    const { runStatus } = await import("../../../../src/serialization/tasks/env");
    const configFile: RootConfigurationFile = {
      config: {
        defaultEnvProfile: "default",
        envProfiles: {
          default: {
            host: "https://cm.example",
          },
          demo: {
            host: "https://demo.example",
            deployTokenExpiresIn: 60,
            deployTokenLastUpdated: new Date().toISOString(),
          },
        },
      },
    };
    readRootConfigurationFile.mockReturnValue(configFile);
    readRootConfiguration.mockReturnValue({ environments: {} });
    getCmTokens.mockResolvedValue(undefined);
    getDeployToken.mockResolvedValue(undefined);
    logger.isJson.mockReturnValue(false);

    await runStatus({ config: "/tmp" });

    expect(logger.warn).toHaveBeenCalledWith(
      "The environment name 'default' is reserved. Choose a different name and set it as default."
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Found a reserved 'default' environment entry. It will be ignored by status."
    );
  });

  it("warns when no environments are configured", async () => {
    const { runStatus } = await import("../../../../src/serialization/tasks/env");
    const configFile: RootConfigurationFile = {
      config: {
        defaultEnvProfile: "demo",
        envProfiles: {},
      },
    };
    readRootConfigurationFile.mockReturnValue(configFile);
    readRootConfiguration.mockReturnValue({ environments: {} });
    logger.isJson.mockReturnValue(false);

    await runStatus({ config: "/tmp" });

    expect(logger.warn).toHaveBeenCalledWith(
      "Default environment 'demo' was not found in env profiles. Run init to add it."
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "No environments are configured. Use the init command to add one."
    );
  });

  it("prints configured environment details and expiring token warnings", async () => {
    const { runStatus } = await import("../../../../src/serialization/tasks/env");
    const configFile: RootConfigurationFile = {
      config: {
        defaultEnvProfile: "demo",
        envProfiles: {
          demo: {},
          prod: {
            host: "https://prod.example",
            authority: "https://auth.example",
            ref: "main",
            environmentType: "cm",
            editingHostEnvironmentIds: ["eh-1"],
            cacheAuthenticationToken: false,
            deployTokenExpiresIn: 60,
            deployTokenLastUpdated: new Date().toISOString(),
          },
        },
      },
    };
    readRootConfigurationFile.mockReturnValue(configFile);
    readRootConfiguration.mockReturnValue({ environments: {} });
    getCmTokens.mockResolvedValue({ accessToken: "cached" });
    getDeployToken.mockResolvedValue(undefined);
    logger.isJson.mockReturnValue(false);

    await runStatus({ config: "/tmp" });

    expect(logger.warn).toHaveBeenCalledWith("\ndemo (default)", "yellow");
    expect(logger.info).toHaveBeenCalledWith("  status: empty (not configured)");
    expect(logger.info).toHaveBeenCalledWith("  editingHostEnvironmentIds:");
    expect(logger.info).toHaveBeenCalledWith("    eh-1");
    expect(logger.warn).toHaveBeenCalledWith("  deployToken: expiring soon", "yellow");
  });

  it("logs out all environments", async () => {
    const { runLogout } = await import("../../../../src/serialization/tasks/env");
    const configFile: RootConfigurationFile = {
      config: {
        envProfiles: {
          demo: { accessToken: "a", deployToken: "d" },
          prod: { accessToken: "b", deployToken: "e" },
        },
      },
    };
    readRootConfigurationFile.mockReturnValue(configFile);

    await runLogout({ config: "/tmp", all: true });

    expect(clearCmTokens).toHaveBeenCalledTimes(2);
    expect(clearDeployToken).toHaveBeenCalledTimes(2);
    expect(writeRootConfigurationFile).toHaveBeenCalledWith("/tmp", configFile.config);
    expect(logger.info).toHaveBeenCalledWith(
      "Cleared stored tokens for all environments.",
      "green"
    );
  });

  it("errors when logging out without an environment name", async () => {
    const { runLogout } = await import("../../../../src/serialization/tasks/env");
    readRootConfigurationFile.mockReturnValue({ config: { envProfiles: {} } });

    await expect(runLogout({ config: "/tmp" })).rejects.toThrow(
      "Environment name is required. Use --environment-name or --all."
    );
  });

  it("logs out a single environment", async () => {
    const { runLogout } = await import("../../../../src/serialization/tasks/env");
    const configFile: RootConfigurationFile = {
      config: {
        envProfiles: {
          demo: { accessToken: "a", deployToken: "d" },
        },
      },
    };
    readRootConfigurationFile.mockReturnValue(configFile);

    await runLogout({ config: "/tmp", environmentName: "demo" });

    expect(clearCmTokens).toHaveBeenCalledWith("demo");
    expect(clearDeployToken).toHaveBeenCalledWith("demo");
    expect(writeRootConfigurationFile).toHaveBeenCalledWith("/tmp", configFile.config);
    expect(logger.info).toHaveBeenCalledWith(
      "Cleared stored tokens for environment 'demo'.",
      "green"
    );
  });

  it("fetches a deploy token using client credentials", async () => {
    const { runDeployToken } = await import("../../../../src/serialization/tasks/env");
    const configFile: RootConfigurationFile = {
      config: {
        envProfiles: {
          demo: {},
        },
      },
    };
    readRootConfigurationFile.mockReturnValue(configFile);
    readRootConfiguration.mockReturnValue({ environments: { demo: {} } });
    requestClientCredentialsToken.mockResolvedValue({ accessToken: "token", expiresIn: 3600 });
    setDeployToken.mockResolvedValue(true);

    await runDeployToken({
      config: "/tmp",
      environmentName: "demo",
      useClientCredentials: true,
      clientId: "client",
      clientSecret: "secret",
    });

    expect(requestClientCredentialsToken).toHaveBeenCalled();
    expect(setDeployToken).toHaveBeenCalledWith("demo", "token");
    expect(writeRootConfigurationFile).toHaveBeenCalledWith("/tmp", configFile.config);
  });
});
