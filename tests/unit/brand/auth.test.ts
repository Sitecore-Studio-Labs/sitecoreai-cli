import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_REQUIRED_SCOPES, hasBrandScopes } from "../../../src/brand/api/auth";
import { extractScopes } from "../../../src/shared/jwt";

vi.mock("../../../src/shared/keychain", () => ({
  getBrandClientSecret: vi.fn(),
  getBrandToken: vi.fn(),
  setBrandToken: vi.fn(),
  clearBrandToken: vi.fn(),
}));
vi.mock("../../../src/auth/client-credentials", () => ({
  requestClientCredentialsToken: vi.fn(),
}));

/**
 * Build a minimal JWT with the given `scope` claim. The Brand auth
 * helpers only decode the payload; the signature isn't checked, so a
 * dummy header + dummy signature suffice. Mirrors what Auth0 hands
 * back for an AI APIs key client-credentials grant.
 */
const makeJwt = (payload: Record<string, unknown>): string => {
  const b64url = (input: string): string =>
    Buffer.from(input, "utf8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return [
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    b64url(JSON.stringify(payload)),
    "sig",
  ].join(".");
};

describe("brand/api/auth — extractScopes", () => {
  it("reads the space-delimited `scope` claim", () => {
    const token = makeJwt({ scope: "ai.org.brd:r ai.org.brd:w ai.orgs.br:gen" });
    expect(extractScopes(token)).toEqual(["ai.org.brd:r", "ai.org.brd:w", "ai.orgs.br:gen"]);
  });

  it("falls back to the `scp` array claim when `scope` is absent", () => {
    const token = makeJwt({ scp: ["ai.org.brd:r", "ai.orgs.br:gen"] });
    expect(extractScopes(token)).toEqual(["ai.org.brd:r", "ai.orgs.br:gen"]);
  });

  it("returns [] for malformed tokens", () => {
    expect(extractScopes("not.a.jwt")).toEqual([]);
    expect(extractScopes("only-one-part")).toEqual([]);
    expect(extractScopes("")).toEqual([]);
  });
});

describe("brand/api/auth — hasBrandScopes", () => {
  it("returns true when the required scope (Brand Review generate) is present", () => {
    const token = makeJwt({
      scope: "ai.org.brd:r ai.org.br:gen ai.org:admin",
    });
    expect(hasBrandScopes(token)).toBe(true);
  });

  it("returns false when the Brand Review generate scope is missing", () => {
    const token = makeJwt({
      scope: "ai.org.brd:r ai.org.brd:w ai.org:admin", // no ai.org.br:gen
    });
    expect(hasBrandScopes(token)).toBe(false);
  });

  it("returns false for a Pages/Sites automation client token (xmclouddeploy.* / xmcpub.*)", () => {
    const token = makeJwt({
      scope: "xmclouddeploy.organizations:read xmcpub.jobs.t:r xmcpub.jobs.t:w",
    });
    expect(hasBrandScopes(token)).toBe(false);
  });

  it("rejects empty / malformed tokens", () => {
    expect(hasBrandScopes("")).toBe(false);
    expect(hasBrandScopes("garbage")).toBe(false);
  });
});

/**
 * `acquireBrandToken` — the auth seam every Brand API call mints
 * through. Verifies the env-var fallback wires through the resolver
 * without consulting the keychain, which is what the showcase
 * orchestrator depends on in serverless Vercel functions.
 */
describe("brand/api/auth — acquireBrandToken env-var fallback", () => {
  const BRAND_ENV_KEYS = [
    "SITECOREAI_BRAND_CLIENT_ID",
    "SITECOREAI_BRAND_CLIENT_SECRET",
    "SITECOREAI_BRAND_AUTHORITY",
    "SITECOREAI_BRAND_AUDIENCE",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of BRAND_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    const keychain = await import("../../../src/shared/keychain");
    const serializationAuth = await import("../../../src/auth/client-credentials");
    vi.mocked(keychain.getBrandClientSecret).mockReset();
    vi.mocked(keychain.getBrandToken).mockReset();
    vi.mocked(keychain.setBrandToken).mockReset();
    vi.mocked(serializationAuth.requestClientCredentialsToken).mockReset();
  });

  afterEach(() => {
    for (const key of BRAND_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("mints a token from SITECOREAI_BRAND_* env vars without touching the keychain secret", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "env-secret";

    const keychain = await import("../../../src/shared/keychain");
    const serializationAuth = await import("../../../src/auth/client-credentials");
    const { acquireBrandToken } = await import("../../../src/brand/api/auth");

    vi.mocked(keychain.getBrandToken).mockResolvedValue(undefined);
    vi.mocked(serializationAuth.requestClientCredentialsToken).mockResolvedValue({
      accessToken: "minted.from.env",
      expiresIn: 3600,
    });

    const token = await acquireBrandToken({ orgId: "org_x" });

    expect(token).toBe("minted.from.env");
    expect(keychain.getBrandClientSecret).not.toHaveBeenCalled();
    expect(serializationAuth.requestClientCredentialsToken).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "env-cid",
        clientSecret: "env-secret",
        authority: "https://auth.sitecorecloud.io",
        audience: "https://api.sitecorecloud.io",
      })
    );
  });

  it("throws AUTH_BRAND_REQUIRED with no credential available from any tier", async () => {
    const keychain = await import("../../../src/shared/keychain");
    const { acquireBrandToken } = await import("../../../src/brand/api/auth");

    vi.mocked(keychain.getBrandToken).mockResolvedValue(undefined);

    await expect(acquireBrandToken({ orgId: "org_x" })).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
  });
});

/**
 * Cached brand token expiry — Sitecore returns 403 "Token has expired"
 * (not 401) for stale Bearers, and `requestBrandApi`'s re-mint path
 * only triggers on 401. Pre-gating expired tokens in `acquireBrandToken`
 * is the load-bearing fix; without it, a stale keychain entry surfaces
 * as a hard BRAND_API_FAILED on every call until manually cleared.
 */
describe("brand/api/auth — acquireBrandToken cache expiry gate", () => {
  const BRAND_ENV_KEYS = ["SITECOREAI_BRAND_CLIENT_ID", "SITECOREAI_BRAND_CLIENT_SECRET"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  const makeJwtWithExp = (offsetSeconds: number): string => {
    const nowS = Math.floor(Date.now() / 1000);
    return makeJwt({ scope: "ai.org.br:gen", exp: nowS + offsetSeconds });
  };

  beforeEach(async () => {
    for (const key of BRAND_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    const keychain = await import("../../../src/shared/keychain");
    const serializationAuth = await import("../../../src/auth/client-credentials");
    vi.mocked(keychain.getBrandClientSecret).mockReset();
    vi.mocked(keychain.getBrandToken).mockReset();
    vi.mocked(keychain.setBrandToken).mockReset();
    vi.mocked(keychain.clearBrandToken).mockReset();
    vi.mocked(serializationAuth.requestClientCredentialsToken).mockReset();
  });

  afterEach(() => {
    for (const key of BRAND_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("returns a cached token that is still well within its lifetime", async () => {
    const keychain = await import("../../../src/shared/keychain");
    const { acquireBrandToken } = await import("../../../src/brand/api/auth");

    const fresh = makeJwtWithExp(3600);
    vi.mocked(keychain.getBrandToken).mockResolvedValue(fresh);

    const token = await acquireBrandToken({ orgId: "org_x" });

    expect(token).toBe(fresh);
    expect(keychain.clearBrandToken).not.toHaveBeenCalled();
  });

  it("evicts an expired cached token and mints a fresh one", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "env-secret";

    const keychain = await import("../../../src/shared/keychain");
    const serializationAuth = await import("../../../src/auth/client-credentials");
    const { acquireBrandToken } = await import("../../../src/brand/api/auth");

    vi.mocked(keychain.getBrandToken).mockResolvedValue(makeJwtWithExp(-60));
    vi.mocked(serializationAuth.requestClientCredentialsToken).mockResolvedValue({
      accessToken: "freshly.minted.token",
      expiresIn: 3600,
    });

    const token = await acquireBrandToken({ orgId: "org_x" });

    expect(token).toBe("freshly.minted.token");
    expect(keychain.clearBrandToken).toHaveBeenCalledWith("org_x");
    expect(serializationAuth.requestClientCredentialsToken).toHaveBeenCalled();
  });

  it("treats a token inside the 60s safety margin as expired", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "env-secret";

    const keychain = await import("../../../src/shared/keychain");
    const serializationAuth = await import("../../../src/auth/client-credentials");
    const { acquireBrandToken } = await import("../../../src/brand/api/auth");

    // 30s left — inside the 60s margin, so this should re-mint even
    // though the token isn't yet technically expired.
    vi.mocked(keychain.getBrandToken).mockResolvedValue(makeJwtWithExp(30));
    vi.mocked(serializationAuth.requestClientCredentialsToken).mockResolvedValue({
      accessToken: "remint-in-margin",
      expiresIn: 3600,
    });

    const token = await acquireBrandToken({ orgId: "org_x" });

    expect(token).toBe("remint-in-margin");
    expect(keychain.clearBrandToken).toHaveBeenCalledWith("org_x");
  });
});

describe("brand/api/auth — BRAND_REQUIRED_SCOPES", () => {
  it("matches what scai actually needs for the operations it ships today (Brand Review only)", () => {
    // scai ships only Brand Review today; the minimum required scope
    // is `ai.org.br:gen` (singular `org` — verified empirically
    // 2026-05-14; the Sitecore OpenAPI docs example shows `ai.orgs`
    // with a plural typo). When Brand Management primitives land,
    // they will lift this set to include `ai.org.brd:r/w`. The test
    // is the gate — bump it intentionally when adding operations.
    expect([...BRAND_REQUIRED_SCOPES]).toEqual(["ai.org.br:gen"]);
  });
});
