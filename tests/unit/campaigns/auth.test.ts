import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `acquireCampaignToken` resolution-order coverage. The keychain
 * (`getCampaignToken`/`setCampaignToken`/`getBrandClientSecret`) and the
 * M2M token mint (`requestClientCredentialsToken`) are mocked so this
 * exercises the auth seam's branches: missing-org rejection,
 * cached-fresh short-circuit, cached-but-expired fall-through,
 * missing-secret / missing-clientId AUTH_BRAND_REQUIRED, the
 * authority/audience default fallbacks, the no-access-token rejection,
 * and the persist-on-success path. No real auth server, no real keychain.
 */

const keychainMocks = vi.hoisted(() => ({
  getCampaignToken: vi.fn(),
  setCampaignToken: vi.fn(),
  getBrandClientSecret: vi.fn(),
}));
vi.mock("../../../src/shared/keychain", () => ({
  getCampaignToken: keychainMocks.getCampaignToken,
  setCampaignToken: keychainMocks.setCampaignToken,
  getBrandClientSecret: keychainMocks.getBrandClientSecret,
}));

const authMocks = vi.hoisted(() => ({ requestClientCredentialsToken: vi.fn() }));
vi.mock("../../../src/auth/client-credentials", () => ({
  DEFAULT_SITECORE_API_AUDIENCE: "https://api.sitecorecloud.io",
  requestClientCredentialsToken: authMocks.requestClientCredentialsToken,
}));

import { acquireCampaignToken } from "../../../src/campaigns/auth";

/** Build a JWT whose `exp` claim is `offsetSeconds` from now. */
const makeJwt = (offsetSeconds: number): string => {
  const b64url = (input: string): string =>
    Buffer.from(input, "utf8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const exp = Math.floor(Date.now() / 1000) + offsetSeconds;
  return [
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    b64url(JSON.stringify({ exp })),
    "sig",
  ].join(".");
};

const brandCredential = {
  clientId: "brand-client",
  authority: "https://auth.example.test",
  audience: "https://audience.example.test",
} as never;

const options = { organizationId: "org-1", brandCredential };

beforeEach(() => {
  vi.clearAllMocks();
  keychainMocks.getCampaignToken.mockResolvedValue(undefined);
  keychainMocks.setCampaignToken.mockResolvedValue(true);
  keychainMocks.getBrandClientSecret.mockResolvedValue("brand-secret");
  authMocks.requestClientCredentialsToken.mockResolvedValue({ accessToken: "minted-token" });
});

describe("acquireCampaignToken — org id requirement", () => {
  it("throws AUTH_BRAND_REQUIRED when no organizationId is supplied", async () => {
    await expect(
      acquireCampaignToken({ organizationId: undefined, brandCredential })
    ).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
    expect(keychainMocks.getCampaignToken).not.toHaveBeenCalled();
  });
});

describe("acquireCampaignToken — cache path", () => {
  it("returns a cached token without minting when it is still fresh", async () => {
    const cached = makeJwt(3600);
    keychainMocks.getCampaignToken.mockResolvedValue(cached);

    const token = await acquireCampaignToken(options);

    expect(token).toBe(cached);
    expect(authMocks.requestClientCredentialsToken).not.toHaveBeenCalled();
    expect(keychainMocks.getBrandClientSecret).not.toHaveBeenCalled();
  });

  it("falls through to a mint when the cached token is expired", async () => {
    keychainMocks.getCampaignToken.mockResolvedValue(makeJwt(-3600));

    const token = await acquireCampaignToken(options);

    expect(token).toBe("minted-token");
    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledOnce();
  });

  it("falls through to a mint when the cached token is inside the 60s skew window", async () => {
    keychainMocks.getCampaignToken.mockResolvedValue(makeJwt(30));

    await acquireCampaignToken(options);

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledOnce();
  });

  it("falls through to a mint when the cached value is not a decodable JWT", async () => {
    keychainMocks.getCampaignToken.mockResolvedValue("garbage");

    await acquireCampaignToken(options);

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledOnce();
  });
});

describe("acquireCampaignToken — missing AI APIs key", () => {
  it("throws AUTH_BRAND_REQUIRED when no client secret is stored for the org", async () => {
    keychainMocks.getBrandClientSecret.mockResolvedValue(undefined);

    await expect(acquireCampaignToken(options)).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
    expect(authMocks.requestClientCredentialsToken).not.toHaveBeenCalled();
  });

  it("throws AUTH_BRAND_REQUIRED when the brand credential carries no clientId", async () => {
    await expect(
      acquireCampaignToken({ organizationId: "org-1", brandCredential: {} as never })
    ).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
    expect(authMocks.requestClientCredentialsToken).not.toHaveBeenCalled();
  });

  it("throws AUTH_BRAND_REQUIRED when the brand credential block is undefined", async () => {
    await expect(
      acquireCampaignToken({ organizationId: "org-1", brandCredential: undefined })
    ).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
  });
});

describe("acquireCampaignToken — mint path", () => {
  it("mints with the brand credential's authority and audience", async () => {
    await acquireCampaignToken(options);

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledWith({
      authority: "https://auth.example.test",
      clientId: "brand-client",
      clientSecret: "brand-secret",
      audience: "https://audience.example.test",
    });
  });

  it("falls back to the default authority and audience when the credential omits them", async () => {
    await acquireCampaignToken({
      organizationId: "org-1",
      brandCredential: { clientId: "brand-client" } as never,
    });

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledWith({
      authority: "https://auth.sitecorecloud.io",
      clientId: "brand-client",
      clientSecret: "brand-secret",
      audience: "https://api.sitecorecloud.io",
    });
  });

  it("caches the minted token keyed by org id and returns it", async () => {
    const token = await acquireCampaignToken(options);

    expect(keychainMocks.setCampaignToken).toHaveBeenCalledWith("org-1", "minted-token");
    expect(token).toBe("minted-token");
  });

  it("throws AUTH_BRAND_REQUIRED when the mint yields no access token", async () => {
    authMocks.requestClientCredentialsToken.mockResolvedValue({ accessToken: "" });

    await expect(acquireCampaignToken(options)).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
    expect(keychainMocks.setCampaignToken).not.toHaveBeenCalled();
  });
});
