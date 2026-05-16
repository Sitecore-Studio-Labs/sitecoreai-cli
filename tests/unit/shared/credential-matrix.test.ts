import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for `resolveCredentialMatrix` — the four-credential
 * presence check shared by `scai setup status` and `scai_overview`.
 * The keychain reads are mocked; `hasAiSkills` is passed in by the
 * caller, so it is exercised directly.
 */
const mocks = vi.hoisted(() => ({
  getDeployToken: vi.fn(),
  getCmClientCredential: vi.fn(),
}));

vi.mock("../../../src/shared/keychain", () => ({
  getDeployToken: mocks.getDeployToken,
  getCmClientCredential: mocks.getCmClientCredential,
}));

const { resolveCredentialMatrix } = await import("../../../src/shared/credential-matrix");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDeployToken.mockResolvedValue(undefined);
  mocks.getCmClientCredential.mockResolvedValue(undefined);
});

describe("resolveCredentialMatrix", () => {
  it("reports all four present", async () => {
    mocks.getDeployToken.mockResolvedValue("deploy-token");
    mocks.getCmClientCredential.mockResolvedValue({ clientId: "c", clientSecret: "s" });
    const matrix = await resolveCredentialMatrix(
      "prod",
      { clientId: "bc", clientSecret: "bs", authority: "https://auth" },
      true
    );
    expect(matrix).toEqual({ deploy: true, cmClient: true, aiSkills: true, brief: true });
  });

  it("reports all four absent for a bare environment", async () => {
    const matrix = await resolveCredentialMatrix("empty", {}, false);
    expect(matrix).toEqual({ deploy: false, cmClient: false, aiSkills: false, brief: false });
  });

  it("falls back to env.deployToken when the keychain has none", async () => {
    const matrix = await resolveCredentialMatrix("prod", { deployToken: "config-token" }, false);
    expect(matrix.deploy).toBe(true);
  });

  it("passes hasAiSkills straight through", async () => {
    expect((await resolveCredentialMatrix("p", {}, true)).aiSkills).toBe(true);
    expect((await resolveCredentialMatrix("p", {}, false)).aiSkills).toBe(false);
  });

  it("requires clientId + clientSecret + authority for brief", async () => {
    expect((await resolveCredentialMatrix("p", { clientId: "c" }, false)).brief).toBe(false);
    expect(
      (await resolveCredentialMatrix("p", { clientId: "c", clientSecret: "s" }, false)).brief
    ).toBe(false);
    expect(
      (
        await resolveCredentialMatrix(
          "p",
          { clientId: "c", clientSecret: "s", authority: "https://auth" },
          false
        )
      ).brief
    ).toBe(true);
  });

  it("reports cmClient true only when the keychain returns a credential", async () => {
    expect((await resolveCredentialMatrix("p", {}, false)).cmClient).toBe(false);
    mocks.getCmClientCredential.mockResolvedValue({ clientId: "c", clientSecret: "s" });
    expect((await resolveCredentialMatrix("p", {}, false)).cmClient).toBe(true);
  });
});
