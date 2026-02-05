import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../../../src/shared/keychain", () => ({
  getDeployToken: vi.fn().mockResolvedValue(undefined),
  setDeployToken: vi.fn().mockResolvedValue(true),
  clearDeployToken: vi.fn().mockResolvedValue(true),
  getCmTokens: vi.fn().mockResolvedValue(undefined),
  setCmTokens: vi.fn().mockResolvedValue(true),
  clearCmTokens: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../../src/shared/prompt", () => ({
  assertInteractive: vi.fn((message: string) => {
    throw new Error(message);
  }),
  promptText: vi.fn().mockResolvedValue("demo"),
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptSecret: vi.fn().mockResolvedValue("secret"),
}));

vi.mock("../../../../src/shared/browser", () => ({
  openBrowser: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/serialization/sitecore-api", () => ({
  requestClientCredentialsToken: vi.fn().mockResolvedValue({
    accessToken: "token",
    expiresIn: 3600,
  }),
  requestDeviceAuthorization: vi.fn().mockResolvedValue({
    deviceCode: "device",
    userCode: "user",
    verificationUri: "https://verify",
    expiresIn: 30,
    interval: 1,
  }),
  pollDeviceToken: vi.fn().mockResolvedValue({
    accessToken: "token",
    refreshToken: "refresh",
    expiresIn: 3600,
    tokenType: "Bearer",
  }),
}));

vi.mock("../../../../src/deploy/api", () => ({
  fetchOrganization: vi.fn().mockResolvedValue({ id: "org-1" }),
  fetchProjects: vi.fn().mockResolvedValue([{ id: "proj-1", name: "Project" }]),
  fetchProjectEnvironments: vi.fn().mockResolvedValue([{ id: "env-1", name: "Env", type: "cm" }]),
  fetchEnvironment: vi.fn().mockResolvedValue({ id: "env-1", projectId: "proj-1", tenantId: "t1" }),
  resolveHostFromEnvironment: vi.fn().mockReturnValue("https://cm.example"),
}));

describe("init task runner", () => {
  let originalIn: boolean | undefined;
  let originalOut: boolean | undefined;

  beforeEach(() => {
    originalIn = process.stdin.isTTY;
    originalOut = process.stdout.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
  });

  it("requires a TTY for wizard mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const tasks = await import("../../../../src/serialization/tasks");
    await expect(tasks.runInit({ wizard: true })).rejects.toThrow("Wizard mode requires a TTY");
  });

  it("requires an environment name when not running the wizard", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const tasks = await import("../../../../src/serialization/tasks");
    await expect(tasks.runInit({ host: "https://cm.example" })).rejects.toThrow(
      "Environment name is required"
    );
  });

  it("sets default when requested without other changes", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-init-"));
    await fs.writeFile(
      path.join(rootDir, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          envProfiles: {
            demo: {
              name: "demo",
              host: "https://cm.example",
            },
          },
          defaultEnvProfile: "old",
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(rootDir, "module.module.json"), "{}", "utf8");
    const tasks = await import("../../../../src/serialization/tasks");
    await tasks.runInit({ config: rootDir, environmentName: "demo", setDefault: true });
    const config = JSON.parse(await fs.readFile(path.join(rootDir, "sitecoreai.cli.json"), "utf8"));
    expect(config.defaultEnvProfile).toBe("demo");
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("obtains a deploy token with client credentials", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-init-"));
    await fs.writeFile(path.join(rootDir, "module.module.json"), "{}", "utf8");
    const tasks = await import("../../../../src/serialization/tasks");
    await tasks.runInit({
      config: rootDir,
      environmentName: "demo",
      host: "https://cm.example",
      useClientCredentials: true,
      clientId: "client-id",
      clientSecret: "client-secret",
      setDefault: true,
    });
    const config = JSON.parse(await fs.readFile(path.join(rootDir, "sitecoreai.cli.json"), "utf8"));
    expect(config.envProfiles.demo).toBeDefined();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("throws when setting default for an unknown environment", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-init-"));
    await fs.writeFile(path.join(rootDir, "module.module.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(rootDir, "sitecoreai.cli.json"),
      JSON.stringify({ modules: ["./module.module.json"] })
    );
    const tasks = await import("../../../../src/serialization/tasks");
    await expect(
      tasks.runInit({ config: rootDir, environmentName: "missing", setDefault: true })
    ).rejects.toThrow("does not exist");
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("uses device login when deploy token is missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-init-"));
    await fs.writeFile(path.join(rootDir, "module.module.json"), "{}", "utf8");
    const originalIn = process.stdin.isTTY;
    const originalOut = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const tasks = await import("../../../../src/serialization/tasks");
    await tasks.runInit({
      config: rootDir,
      environmentName: "demo",
      host: "https://cm.example",
      clientId: "device-client",
    });
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
