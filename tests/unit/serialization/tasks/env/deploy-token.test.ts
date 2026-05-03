import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootConfigurationFile } from "../../../../../src/config";

const readRootConfigurationFile = vi.fn();
const readRootConfiguration = vi.fn();
const writeRootConfigurationFile = vi.fn();

vi.mock("../../../../../src/config", () => ({
  readRootConfigurationFile,
  readRootConfiguration,
  writeRootConfigurationFile,
}));

const openBrowser = vi.fn();
vi.mock("../../../../../src/shared/browser", () => ({ openBrowser }));

const assertValidUrl = vi.fn();
vi.mock("../../../../../src/shared/validate", () => ({ assertValidUrl }));

const setDeployToken = vi.fn();
vi.mock("../../../../../src/shared/keychain", () => ({ setDeployToken }));

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
vi.mock("../../../../../src/serialization/sitecore-api", () => ({
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  pollDeviceToken,
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

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
    expect(logSpy).toHaveBeenCalledWith("token");
    logSpy.mockRestore();
  });

  it("uses the selected environment client id for client credentials", async () => {
    readRootConfigurationFile.mockReturnValue({
      config: { envProfiles: { demo: {}, other: { clientId: "wrong" } } },
    } as RootConfigurationFile);
    readRootConfiguration.mockReturnValue({
      environments: { demo: { clientId: "right", clientSecret: "secret" } },
    });
    requestClientCredentialsToken.mockResolvedValue({ accessToken: "token", expiresIn: 60 });

    const { runDeployToken } =
      await import("../../../../../src/serialization/tasks/env/deploy-token");
    await runDeployToken({ environmentName: "demo", useClientCredentials: true });

    expect(requestClientCredentialsToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "right", clientSecret: "secret" }),
      undefined
    );
    expect(promptSecret).not.toHaveBeenCalled();
  });

  it("persists the client id for client credentials", async () => {
    readRootConfigurationFile.mockReturnValue({
      config: { envProfiles: { demo: {} } },
    } as RootConfigurationFile);
    readRootConfiguration.mockReturnValue({
      environments: { demo: { clientId: "client-123", clientSecret: "secret" } },
    });
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
