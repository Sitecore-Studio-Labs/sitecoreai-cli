import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runBrandLogin` orchestration coverage. The token mint, keychain,
 * config file IO, prompts, and scope extraction are all mocked so this
 * exercises only the runner's branches: existing-credential gating,
 * non-interactive flag requirements, scope validation (Pages/Sites
 * client rejection, no-recognized-scope rejection), and the
 * persist-on-success path. `resolveBrandOrgId` is covered separately
 * in tests/unit/brand/login-org-resolution.test.ts.
 */

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  readRootConfigurationFile: vi.fn(),
  writeRootConfigurationFile: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
  readRootConfigurationFile: configMocks.readRootConfigurationFile,
  writeRootConfigurationFile: configMocks.writeRootConfigurationFile,
}));

const authMocks = vi.hoisted(() => ({
  requestClientCredentialsToken: vi.fn(),
}));

vi.mock("../../../../src/auth/client-credentials", () => ({
  DEFAULT_SITECORE_API_AUDIENCE: "https://api.sitecorecloud.io",
  requestClientCredentialsToken: authMocks.requestClientCredentialsToken,
}));

const keychainMocks = vi.hoisted(() => ({
  setBrandClientSecret: vi.fn(),
  setBrandToken: vi.fn(),
  getBrandClientSecret: vi.fn(),
}));

vi.mock("../../../../src/shared/keychain", () => ({
  setBrandClientSecret: keychainMocks.setBrandClientSecret,
  setBrandToken: keychainMocks.setBrandToken,
  getBrandClientSecret: keychainMocks.getBrandClientSecret,
}));

const promptMocks = vi.hoisted(() => ({
  promptConfirm: vi.fn(),
  promptSecret: vi.fn(),
  promptText: vi.fn(),
}));

vi.mock("../../../../src/shared/prompt", () => ({
  promptConfirm: promptMocks.promptConfirm,
  promptSecret: promptMocks.promptSecret,
  promptText: promptMocks.promptText,
}));

const brandAuthMocks = vi.hoisted(() => ({
  extractScopes: vi.fn(),
}));

vi.mock("../../../../src/shared/jwt", () => ({
  extractScopes: brandAuthMocks.extractScopes,
}));

import { runBrandLogin } from "../../../../src/brand/tasks/login";

const baseRoot = {
  defaultEnvironment: "sandbox",
  environments: { sandbox: { organizationId: "org_ABC", name: "sandbox" } },
};

beforeEach(() => {
  for (const m of Object.values(configMocks)) m.mockReset();
  for (const m of Object.values(authMocks)) m.mockReset();
  for (const m of Object.values(keychainMocks)) m.mockReset();
  for (const m of Object.values(promptMocks)) m.mockReset();
  brandAuthMocks.extractScopes.mockReset();

  configMocks.readRootConfiguration.mockReturnValue(baseRoot);
  configMocks.readRootConfigurationFile.mockReturnValue({ config: { brand: {} } });
  authMocks.requestClientCredentialsToken.mockResolvedValue({
    accessToken: "minted.jwt.token",
    expiresIn: 3600,
  });
  brandAuthMocks.extractScopes.mockReturnValue(["ai.org.brd:r", "ai.org.brd:w", "ai.org.br:gen"]);
  keychainMocks.setBrandClientSecret.mockResolvedValue(true);
  keychainMocks.setBrandToken.mockResolvedValue(true);
  keychainMocks.getBrandClientSecret.mockResolvedValue("secret-readback");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const opts = (overrides: Record<string, unknown> = {}): never =>
  ({
    config: "/tmp",
    quiet: true,
    clientId: "client-x",
    clientSecret: "shh",
    ...overrides,
  }) as never;

describe("runBrandLogin — existing-credential gating", () => {
  // The test environment is non-interactive (process.stdin/stdout
  // `isTTY` are undefined), so the runner takes the non-interactive
  // branches without further stubbing.
  it("refuses to overwrite a non-interactive existing credential without --force", async () => {
    configMocks.readRootConfigurationFile.mockReturnValue({
      config: { brand: { org_ABC: { clientId: "old" } } },
    });
    await expect(runBrandLogin(opts())).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(authMocks.requestClientCredentialsToken).not.toHaveBeenCalled();
  });

  it("proceeds past an existing credential when --force is set", async () => {
    configMocks.readRootConfigurationFile.mockReturnValue({
      config: { brand: { org_ABC: { clientId: "old" } } },
    });
    await runBrandLogin(opts({ force: true }));
    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledTimes(1);
    expect(configMocks.writeRootConfigurationFile).toHaveBeenCalledTimes(1);
  });
});

describe("runBrandLogin — non-interactive flag requirements", () => {
  it("throws INPUT_INVALID when clientId is missing and not a TTY", async () => {
    await expect(runBrandLogin(opts({ clientId: undefined }))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when clientSecret is missing and not a TTY", async () => {
    await expect(runBrandLogin(opts({ clientSecret: undefined }))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("runBrandLogin — token mint failures", () => {
  it("wraps an Auth0 rejection as AUTH_BRAND_REQUIRED", async () => {
    authMocks.requestClientCredentialsToken.mockRejectedValue(new Error("invalid_client"));
    await expect(runBrandLogin(opts())).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
  });

  it("throws AUTH_BRAND_REQUIRED when no access token is returned", async () => {
    authMocks.requestClientCredentialsToken.mockResolvedValue({ accessToken: "" });
    await expect(runBrandLogin(opts())).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
  });
});

describe("runBrandLogin — scope validation", () => {
  it("rejects a Pages/Sites automation client (xmclouddeploy scopes, no ai.org)", async () => {
    brandAuthMocks.extractScopes.mockReturnValue(["xmclouddeploy.environments", "xmcpub.publish"]);
    await expect(runBrandLogin(opts())).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
    expect(keychainMocks.setBrandClientSecret).not.toHaveBeenCalled();
  });

  it("rejects a credential carrying no recognized Brand scopes", async () => {
    brandAuthMocks.extractScopes.mockReturnValue(["some.unrelated.scope"]);
    await expect(runBrandLogin(opts())).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
    expect(keychainMocks.setBrandClientSecret).not.toHaveBeenCalled();
  });
});

describe("runBrandLogin — keychain persistence", () => {
  it("throws AUTH_BRAND_REQUIRED when the keychain refuses the secret", async () => {
    keychainMocks.setBrandClientSecret.mockResolvedValue(false);
    await expect(runBrandLogin(opts())).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
    expect(configMocks.writeRootConfigurationFile).not.toHaveBeenCalled();
  });
});

describe("runBrandLogin — success path", () => {
  it("persists the credential record keyed by orgId and stores the token", async () => {
    await runBrandLogin(opts());
    expect(keychainMocks.setBrandClientSecret).toHaveBeenCalledWith("org_ABC", "shh");
    expect(keychainMocks.setBrandToken).toHaveBeenCalledWith("org_ABC", "minted.jwt.token");
    const writtenConfig = configMocks.writeRootConfigurationFile.mock.calls.at(-1)![1];
    expect(writtenConfig.brand.org_ABC).toMatchObject({
      clientId: "client-x",
      audience: "https://api.sitecorecloud.io",
      tokenExpiresIn: 3600,
    });
  });

  it("honors an explicit --org-id over the env profile organizationId", async () => {
    await runBrandLogin(opts({ orgId: "org_EXPLICIT" }));
    expect(keychainMocks.setBrandClientSecret).toHaveBeenCalledWith("org_EXPLICIT", "shh");
  });

  it("succeeds with a review-only key even when other known scopes are missing", async () => {
    brandAuthMocks.extractScopes.mockReturnValue(["ai.org.br:gen"]);
    await runBrandLogin(opts());
    expect(configMocks.writeRootConfigurationFile).toHaveBeenCalledTimes(1);
  });
});
