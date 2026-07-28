import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers `runEnvironmentOnboard`: writes the new profile, preflights it,
 * refuses to clobber an existing one, and preserves sibling profiles.
 * The config reader/writer and the access preflight are mocked;
 * `assertValidHost` runs for real.
 */
const mocks = vi.hoisted(() => ({
  readRootConfigurationFile: vi.fn(),
  writeRootConfigurationFile: vi.fn(),
  checkAccess: vi.fn(),
}));

vi.mock("../../../src/config/root-config", () => ({
  readRootConfigurationFile: mocks.readRootConfigurationFile,
  writeRootConfigurationFile: mocks.writeRootConfigurationFile,
}));
vi.mock("../../../src/policy/access-check", () => ({
  checkAccess: mocks.checkAccess,
}));

const { runEnvironmentOnboard } = await import("../../../src/setup/onboard");

const baseOpts = {
  config: "/proj",
  environmentName: "demo",
  organizationId: "org_1",
  projectId: "proj-1",
  environmentId: "env-1",
  host: "xmc-demo.sitecorecloud.io",
};

const accessReport = {
  environment: "demo",
  ready: false,
  gates: [],
  humanOnlyOperations: [],
};

const configFile = (
  envProfiles: Record<string, Record<string, unknown>>
): { rootPath: string; rootDir: string; config: { envProfiles: typeof envProfiles } } => ({
  rootPath: "/proj/sitecoreai.cli.json",
  rootDir: "/proj",
  config: { envProfiles },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readRootConfigurationFile.mockReturnValue(configFile({}));
  mocks.checkAccess.mockResolvedValue(accessReport);
});

describe("runEnvironmentOnboard", () => {
  it("writes the new environment profile and returns the access preflight", async () => {
    const result = await runEnvironmentOnboard(baseOpts);
    expect(mocks.writeRootConfigurationFile).toHaveBeenCalledTimes(1);
    const written = mocks.writeRootConfigurationFile.mock.calls[0][1] as {
      envProfiles: Record<string, Record<string, unknown>>;
    };
    expect(written.envProfiles.demo).toMatchObject({
      organizationId: "org_1",
      projectId: "proj-1",
      environmentId: "env-1",
      environmentType: "cm",
      host: "xmc-demo.sitecorecloud.io",
      authority: "https://auth.sitecorecloud.io",
    });
    expect(result.access).toEqual(accessReport);
  });

  it("runs the access preflight on the freshly-written environment", async () => {
    await runEnvironmentOnboard(baseOpts);
    expect(mocks.checkAccess).toHaveBeenCalledWith({
      configPath: "/proj",
      environmentName: "demo",
    });
  });

  it("refuses to clobber an existing environment profile", async () => {
    mocks.readRootConfigurationFile.mockReturnValue(configFile({ demo: { host: "existing" } }));
    await expect(runEnvironmentOnboard(baseOpts)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(mocks.writeRootConfigurationFile).not.toHaveBeenCalled();
  });

  it("preserves existing profiles when adding a new one", async () => {
    mocks.readRootConfigurationFile.mockReturnValue(configFile({ other: { host: "other-host" } }));
    await runEnvironmentOnboard(baseOpts);
    const written = mocks.writeRootConfigurationFile.mock.calls[0][1] as {
      envProfiles: Record<string, unknown>;
    };
    expect(Object.keys(written.envProfiles).sort()).toEqual(["demo", "other"]);
  });
});
