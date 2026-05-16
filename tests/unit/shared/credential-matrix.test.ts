import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for `resolveCredentialMatrix` — the credential-presence
 * check shared by `scai setup status` and `scai_overview`. Per
 * `docs/credentials.md` the matrix reports scai's two credential kinds:
 * the automation client (env scope + org scope) and the brand key. A
 * scai-minted automation client is present only when both halves agree:
 * the non-secret metadata in the config AND the secret in the keychain.
 * The keychain reads are mocked; `hasBrand` and `hasOrgClientMetadata`
 * are passed in by the caller, so they are exercised directly.
 */
const mocks = vi.hoisted(() => ({
  getCmClientSecret: vi.fn(),
  getOrgClientSecret: vi.fn(),
}));

vi.mock("../../../src/shared/keychain", () => ({
  getCmClientSecret: mocks.getCmClientSecret,
  getOrgClientSecret: mocks.getOrgClientSecret,
}));

const { resolveCredentialMatrix } = await import("../../../src/shared/credential-matrix");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCmClientSecret.mockResolvedValue(undefined);
  mocks.getOrgClientSecret.mockResolvedValue(undefined);
});

describe("resolveCredentialMatrix", () => {
  it("reports all three credentials present", async () => {
    mocks.getCmClientSecret.mockResolvedValue("cm-secret");
    mocks.getOrgClientSecret.mockResolvedValue("org-secret");
    const matrix = await resolveCredentialMatrix(
      "prod",
      { organizationId: "org-1", automationClient: { clientId: "c" } },
      true,
      true
    );
    expect(matrix).toEqual({ envClient: true, orgClient: true, brand: true });
  });

  it("reports all three absent for a bare environment", async () => {
    const matrix = await resolveCredentialMatrix("empty", {}, false, false);
    expect(matrix).toEqual({ envClient: false, orgClient: false, brand: false });
  });

  it("reports envClient true when config metadata and keychain secret agree", async () => {
    mocks.getCmClientSecret.mockResolvedValue("cm-secret");
    expect(
      (await resolveCredentialMatrix("p", { automationClient: { clientId: "c" } }, false, false))
        .envClient
    ).toBe(true);
  });

  it("reports envClient false when the config metadata is missing", async () => {
    // Secret in the keychain but no `automationClient` block in the
    // config — an incomplete record, reported absent.
    mocks.getCmClientSecret.mockResolvedValue("cm-secret");
    expect((await resolveCredentialMatrix("p", {}, false, false)).envClient).toBe(false);
  });

  it("reports envClient false when the keychain secret is missing", async () => {
    // Config metadata present but no keychain secret — also incomplete.
    expect(
      (await resolveCredentialMatrix("p", { automationClient: { clientId: "c" } }, false, false))
        .envClient
    ).toBe(false);
  });

  it("reports envClient true via the bring-your-own-client escape hatch", async () => {
    const matrix = await resolveCredentialMatrix(
      "p",
      { clientId: "c", useClientCredentials: true },
      false,
      false
    );
    expect(matrix.envClient).toBe(true);
  });

  it("does not count a bring-your-own clientId without useClientCredentials", async () => {
    expect((await resolveCredentialMatrix("p", { clientId: "c" }, false, false)).envClient).toBe(
      false
    );
  });

  it("reports orgClient only when config metadata and keychain secret agree", async () => {
    mocks.getOrgClientSecret.mockResolvedValue("org-secret");
    // No organizationId — the org-scoped client cannot be keyed.
    expect((await resolveCredentialMatrix("p", {}, false, false)).orgClient).toBe(false);
    expect(mocks.getOrgClientSecret).not.toHaveBeenCalled();
    // organizationId + keychain secret present, but no config metadata.
    expect(
      (await resolveCredentialMatrix("p", { organizationId: "org-1" }, false, false)).orgClient
    ).toBe(false);
    // organizationId + config metadata + keychain secret all present.
    expect(
      (await resolveCredentialMatrix("p", { organizationId: "org-1" }, false, true)).orgClient
    ).toBe(true);
    expect(mocks.getOrgClientSecret).toHaveBeenCalledWith("org-1");
  });

  it("passes hasBrand straight through", async () => {
    expect((await resolveCredentialMatrix("p", {}, true, false)).brand).toBe(true);
    expect((await resolveCredentialMatrix("p", {}, false, false)).brand).toBe(false);
  });
});
