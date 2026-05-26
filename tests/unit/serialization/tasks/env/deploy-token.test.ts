import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootConfigurationFile } from "../../../../../src/config/types";

const readRootConfigurationFile = vi.fn();
const readRootConfiguration = vi.fn();
const writeRootConfigurationFile = vi.fn();

vi.mock("../../../../../src/config/root-config", () => ({
  readRootConfigurationFile,
  readRootConfiguration,
  writeRootConfigurationFile,
}));

const openBrowser = vi.fn();
vi.mock("../../../../../src/shared/browser", () => ({ openBrowser }));

const assertValidUrl = vi.fn();
vi.mock("../../../../../src/shared/validate", () => ({ assertValidUrl }));

const setDeployToken = vi.fn();
const setCmTokens = vi.fn();
const setDeployTokenMeta = vi.fn().mockResolvedValue(true);
vi.mock("../../../../../src/shared/keychain", () => ({
  setDeployToken,
  setCmTokens,
  setDeployTokenMeta,
}));

const assertInteractive = vi.fn();
const promptConfirm = vi.fn();
const promptSecret = vi.fn();
const promptText = vi.fn();
vi.mock("../../../../../src/shared/prompt", () => ({
  assertInteractive,
  promptConfirm,
  promptSecret,
  promptText,
}));

const requestClientCredentialsToken = vi.fn();
const requestDeviceAuthorization = vi.fn();
const pollDeviceToken = vi.fn();
vi.mock("../../../../../src/serialization/api/auth", () => ({
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  pollDeviceToken,
  DEFAULT_SITECORE_API_AUDIENCE: "https://api.sitecorecloud.io",
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
};

vi.mock("../../../../../src/shared/cli-tasks", () => ({
  inputError: (message: string) => new Error(message),
  toLogger: () => logger,
}));

describe("runDeployToken", () => {
  const originalIn = process.stdin.isTTY;
  const originalOut = process.stdout.isTTY;
  const originalNonInteractive = process.env.SITECOREAI_NON_INTERACTIVE;

  beforeEach(() => {
    vi.clearAllMocks();
    readRootConfigurationFile.mockReturnValue({
      config: { envProfiles: { demo: {} } },
    } as RootConfigurationFile);
    readRootConfiguration.mockReturnValue({ environments: { demo: {} } });
    openBrowser.mockReturnValue(false);
    setDeployToken.mockResolvedValue(true);
    setCmTokens.mockResolvedValue(true);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env.SITECOREAI_NON_INTERACTIVE;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    if (originalNonInteractive === undefined) {
      delete process.env.SITECOREAI_NON_INTERACTIVE;
    } else {
      process.env.SITECOREAI_NON_INTERACTIVE = originalNonInteractive;
    }
  });

  it("requires an environment name", async () => {
    const { runDeployToken } =
      await import("../../../../../src/serialization/tasks/env/deploy-token");
    await expect(runDeployToken({})).rejects.toThrow(
      "Environment name is required. Use --environment-name."
    );
  });

  it("fails non-interactive client credentials without a secret", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const { runDeployToken } =
      await import("../../../../../src/serialization/tasks/env/deploy-token");
    await expect(
      runDeployToken({ environmentName: "demo", useClientCredentials: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("prompts for client credentials and stores the token", async () => {
    promptText.mockResolvedValue("client");
    promptSecret.mockResolvedValue("secret");
    requestClientCredentialsToken.mockResolvedValue({ accessToken: "token", expiresIn: 60 });
    // Token print routes through process.stdout.write (not console.log)
    // so an MCP transport guard at the call site can short-circuit it.
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { runDeployToken } =
      await import("../../../../../src/serialization/tasks/env/deploy-token");
    await runDeployToken({
      environmentName: "demo",
      useClientCredentials: true,
      print: true,
    });

    expect(requestClientCredentialsToken).toHaveBeenCalled();
    expect(setDeployToken).toHaveBeenCalledWith("demo", "token");
    expect(writeRootConfigurationFile).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith("token\n");
    writeSpy.mockRestore();
  });

  it("refuses to print a token while running under the MCP transport", async () => {
    promptText.mockResolvedValue("client");
    promptSecret.mockResolvedValue("secret");
    requestClientCredentialsToken.mockResolvedValue({ accessToken: "token", expiresIn: 60 });
    const prior = process.env.SITECOREAI_MCP_SERVE;
    process.env.SITECOREAI_MCP_SERVE = "1";
    try {
      const { runDeployToken } =
        await import("../../../../../src/serialization/tasks/env/deploy-token");
      await expect(
        runDeployToken({
          environmentName: "demo",
          useClientCredentials: true,
          print: true,
        })
      ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    } finally {
      if (prior === undefined) {
        delete process.env.SITECOREAI_MCP_SERVE;
      } else {
        process.env.SITECOREAI_MCP_SERVE = prior;
      }
    }
  });

  it("uses the selected environment client id for client credentials", async () => {
    readRootConfigurationFile.mockReturnValue({
      config: { envProfiles: { demo: {}, other: { clientId: "wrong" } } },
    } as RootConfigurationFile);
    readRootConfiguration.mockReturnValue({
      environments: { demo: { clientId: "right" } },
    });
    // The secret never lives on the env profile — it is supplied via
    // `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` and resolved at the auth layer.
    process.env.SITECOREAI_ENV_DEMO_CLIENT_SECRET = "secret";
    requestClientCredentialsToken.mockResolvedValue({ accessToken: "token", expiresIn: 60 });

    const { runDeployToken } =
      await import("../../../../../src/serialization/tasks/env/deploy-token");
    await runDeployToken({ environmentName: "demo", useClientCredentials: true });

    expect(requestClientCredentialsToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "right", clientSecret: "secret" }),
      // scope set requested at login — kept loose so adding a scope
      // (e.g. a new Sitecore API surface) doesn't churn this test.
      expect.stringContaining("xmcloud.cm:admin")
    );
    expect(promptSecret).not.toHaveBeenCalled();
    delete process.env.SITECOREAI_ENV_DEMO_CLIENT_SECRET;
  });

  it("persists the client id for client credentials", async () => {
    readRootConfigurationFile.mockReturnValue({
      config: { envProfiles: { demo: {} } },
    } as RootConfigurationFile);
    readRootConfiguration.mockReturnValue({
      environments: { demo: { clientId: "client-123" } },
    });
    // Secret supplied via the env var, not the config profile.
    process.env.SITECOREAI_ENV_DEMO_CLIENT_SECRET = "secret";
    requestClientCredentialsToken.mockResolvedValue({ accessToken: "token", expiresIn: 60 });

    const { runDeployToken } =
      await import("../../../../../src/serialization/tasks/env/deploy-token");
    await runDeployToken({ environmentName: "demo", useClientCredentials: true });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: {
          demo: expect.objectContaining({ clientId: "client-123" }),
        },
      })
    );
    delete process.env.SITECOREAI_ENV_DEMO_CLIENT_SECRET;
  });

  it("runs device login when requested and logs user instructions", async () => {
    requestDeviceAuthorization.mockResolvedValue({
      deviceCode: "device",
      verificationUri: "https://verify",
      expiresIn: 900,
      interval: 5,
      userCode: "ABCD",
      message: "Use the browser",
    });
    pollDeviceToken.mockResolvedValue({ accessToken: "token" });
    setDeployToken.mockResolvedValue(false);

    const { runDeployToken } =
      await import("../../../../../src/serialization/tasks/env/deploy-token");
    await runDeployToken({ environmentName: "demo", useClientCredentials: false });

    expect(requestDeviceAuthorization).toHaveBeenCalled();
    expect(pollDeviceToken).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Use the browser");
    expect(logger.info).toHaveBeenCalledWith("Complete login at: https://verify");
    expect(logger.info).toHaveBeenCalledWith("Enter code: ABCD");
    expect(logger.warn).toHaveBeenCalled();
  });
});
