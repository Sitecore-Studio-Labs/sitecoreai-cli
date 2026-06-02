import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `resolveEnvironment` — every branch of the dispatch:
 *  1. config path defaults to process.cwd() when omitted
 *  2. envName defaults to root.defaultEnvProfile when no override
 *  3. INPUT_INVALID thrown when neither override nor defaultEnvProfile
 *  4. ENV_NOT_FOUND thrown when envName isn't in root.environments
 *  5. enforceEnvironmentPolicy invoked by default
 *  6. enforceEnvironmentPolicy skipped when skipPolicy=true
 *  7. timeoutMs derived via resolveApiTimeoutMs
 */

const configMocks = vi.hoisted(() => ({
  readRootConfigurationFile: vi.fn(),
  readRootConfiguration: vi.fn(),
}));
const sharedMocks = vi.hoisted(() => ({
  resolveApiTimeoutMs: vi.fn(),
}));
const enforceMock = vi.hoisted(() => ({
  enforceEnvironmentPolicy: vi.fn(),
}));

vi.mock("../../../src/config/root-config", () => configMocks);
vi.mock("../../../src/shared/cli-tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/shared/cli-tasks")>();
  return { ...actual, resolveApiTimeoutMs: sharedMocks.resolveApiTimeoutMs };
});
vi.mock("../../../src/policy/enforce", () => enforceMock);

import { resolveEnvironment } from "../../../src/policy/environment";

const buildRootFile = (defaultEnvProfile?: string) => ({
  config: { defaultEnvProfile },
  rootDir: "/cfg-root",
});

const buildRoot = (envName: string, env: object = { host: "x" }) => ({
  environments: { [envName]: env },
  settings: {},
});

beforeEach(() => {
  configMocks.readRootConfigurationFile.mockReset();
  configMocks.readRootConfiguration.mockReset();
  sharedMocks.resolveApiTimeoutMs.mockReset().mockReturnValue(30_000);
  enforceMock.enforceEnvironmentPolicy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEnvironment — config + envName resolution", () => {
  it("defaults config path to process.cwd() when options.config is omitted", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("dev"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("dev"));
    resolveEnvironment({ environmentName: "dev" });
    expect(configMocks.readRootConfigurationFile).toHaveBeenCalledWith(process.cwd());
  });

  it("uses options.config when set", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("dev"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("dev"));
    resolveEnvironment({ config: "/custom/path", environmentName: "dev" });
    expect(configMocks.readRootConfigurationFile).toHaveBeenCalledWith("/custom/path");
  });

  it("falls back to root.defaultEnvProfile when no environmentName is passed", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("staging"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("staging"));
    const resolved = resolveEnvironment({});
    expect(resolved.envName).toBe("staging");
  });

  it("prefers options.environmentName over defaultEnvProfile", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("staging"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("prod", { host: "p" }));
    const resolved = resolveEnvironment({ environmentName: "prod" });
    expect(resolved.envName).toBe("prod");
  });

  it("throws INPUT_INVALID when neither override nor defaultEnvProfile is available", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile(undefined));
    expect(() => resolveEnvironment({})).toThrow(/Environment name is required/);
  });

  it("throws ENV_NOT_FOUND when envName is not present in root.environments", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("missing"));
    configMocks.readRootConfiguration.mockReturnValue({ environments: {}, settings: {} });
    expect(() => resolveEnvironment({})).toThrow(/Environment 'missing' is not configured/);
  });
});

describe("resolveEnvironment — policy gate", () => {
  it("invokes enforceEnvironmentPolicy by default", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("dev"));
    const env = { host: "x" };
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("dev", env));
    resolveEnvironment({});
    expect(enforceMock.enforceEnvironmentPolicy).toHaveBeenCalledWith({
      envName: "dev",
      environment: env,
      configRootDir: "/cfg-root",
    });
  });

  it("skips the policy gate when skipPolicy=true (setup / mcp serve startup)", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("dev"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("dev"));
    resolveEnvironment({ skipPolicy: true });
    expect(enforceMock.enforceEnvironmentPolicy).not.toHaveBeenCalled();
  });

  it("propagates the enforce error when the policy rejects the env", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("dev"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("dev"));
    enforceMock.enforceEnvironmentPolicy.mockImplementation(() => {
      throw new Error("POLICY_DENIED: not allowed");
    });
    expect(() => resolveEnvironment({})).toThrow(/POLICY_DENIED/);
  });
});

describe("resolveEnvironment — timeoutMs derivation", () => {
  it("returns the resolved timeoutMs from settings", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("dev"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("dev"));
    sharedMocks.resolveApiTimeoutMs.mockReturnValue(120_000);
    const resolved = resolveEnvironment({});
    expect(resolved.timeoutMs).toBe(120_000);
  });

  it("returns undefined timeoutMs when settings doesn't carry one (passthrough branch)", () => {
    configMocks.readRootConfigurationFile.mockReturnValue(buildRootFile("dev"));
    configMocks.readRootConfiguration.mockReturnValue(buildRoot("dev"));
    sharedMocks.resolveApiTimeoutMs.mockReturnValue(undefined);
    const resolved = resolveEnvironment({});
    expect(resolved.timeoutMs).toBeUndefined();
  });
});
