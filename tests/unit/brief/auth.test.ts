import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `acquireBriefToken` resolution-order coverage. The keychain
 * (`getBriefToken`/`setBriefToken`), the three-tier credential resolver
 * (`resolveClientCredential`), and the M2M token mint
 * (`requestClientCredentialsToken`) are all mocked so this exercises the
 * auth seam's branches: cached-fresh short-circuit, cached-but-expired
 * fall-through, missing-credential AUTH_REQUIRED, missing-authority
 * fall-through, mint-failure wrapping, no-access-token rejection, and
 * the persist-on-success path. No real auth server, no real keychain.
 */

const keychainMocks = vi.hoisted(() => ({ getBriefToken: vi.fn(), setBriefToken: vi.fn() }));
vi.mock("../../../src/shared/keychain", () => ({
  getBriefToken: keychainMocks.getBriefToken,
  setBriefToken: keychainMocks.setBriefToken,
}));

const credentialMocks = vi.hoisted(() => ({ resolveClientCredential: vi.fn() }));
vi.mock("../../../src/shared/client-credential", () => ({
  resolveClientCredential: credentialMocks.resolveClientCredential,
}));

const authMocks = vi.hoisted(() => ({ requestClientCredentialsToken: vi.fn() }));
vi.mock("../../../src/serialization/api/auth", () => ({
  requestClientCredentialsToken: authMocks.requestClientCredentialsToken,
}));

import { acquireBriefToken, BRIEF_SCOPES_REQUESTED } from "../../../src/brief/auth";

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

const environment = {
  authority: "https://auth.sitecorecloud.io",
  clientId: "env-client",
  organizationId: "org-1",
} as never;

const options = { orgId: "org-1", environment };

beforeEach(() => {
  vi.clearAllMocks();
  keychainMocks.getBriefToken.mockResolvedValue(undefined);
  keychainMocks.setBriefToken.mockResolvedValue(true);
  credentialMocks.resolveClientCredential.mockResolvedValue({
    clientId: "resolved-client",
    clientSecret: "resolved-secret",
  });
  authMocks.requestClientCredentialsToken.mockResolvedValue({ accessToken: "minted-token" });
});

describe("BRIEF_SCOPES_REQUESTED", () => {
  it("requests exactly the co.briefs read + write scopes", () => {
    expect([...BRIEF_SCOPES_REQUESTED]).toEqual(["co.briefs:r", "co.briefs:w"]);
  });
});

describe("acquireBriefToken — cache path", () => {
  it("returns a cached token without minting when it is still fresh", async () => {
    const cached = makeJwt(3600);
    keychainMocks.getBriefToken.mockResolvedValue(cached);

    const token = await acquireBriefToken(options);

    expect(token).toBe(cached);
    expect(authMocks.requestClientCredentialsToken).not.toHaveBeenCalled();
    expect(credentialMocks.resolveClientCredential).not.toHaveBeenCalled();
  });

  it("falls through to a mint when the cached token is expired", async () => {
    keychainMocks.getBriefToken.mockResolvedValue(makeJwt(-3600));

    const token = await acquireBriefToken(options);

    expect(token).toBe("minted-token");
    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledOnce();
  });

  it("falls through to a mint when the cached token is within the 60s skew window", async () => {
    keychainMocks.getBriefToken.mockResolvedValue(makeJwt(30));

    await acquireBriefToken(options);

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledOnce();
  });

  it("falls through to a mint when the cached value is not a decodable JWT", async () => {
    keychainMocks.getBriefToken.mockResolvedValue("not-a-jwt");

    await acquireBriefToken(options);

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledOnce();
  });
});

describe("acquireBriefToken — mint path", () => {
  it("mints with the co.briefs scope param and the resolved client pair", async () => {
    await acquireBriefToken(options);

    expect(authMocks.requestClientCredentialsToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "resolved-client", clientSecret: "resolved-secret" }),
      "co.briefs:r co.briefs:w"
    );
  });

  it("caches the minted token in the keychain", async () => {
    await acquireBriefToken(options);

    expect(keychainMocks.setBriefToken).toHaveBeenCalledWith("org-1", "minted-token");
  });

  it("returns the minted access token", async () => {
    const token = await acquireBriefToken(options);

    expect(token).toBe("minted-token");
  });
});

describe("acquireBriefToken — failure branches", () => {
  it("throws AUTH_REQUIRED when no automation-client credential resolves", async () => {
    credentialMocks.resolveClientCredential.mockResolvedValue(undefined);

    await expect(acquireBriefToken(options)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(authMocks.requestClientCredentialsToken).not.toHaveBeenCalled();
  });

  it("throws AUTH_REQUIRED when the env profile carries no authority", async () => {
    await expect(
      acquireBriefToken({ orgId: "org-1", environment: { clientId: "x" } as never })
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(authMocks.requestClientCredentialsToken).not.toHaveBeenCalled();
  });

  it("wraps a mint failure as AUTH_REQUIRED with a scope-denied hint", async () => {
    authMocks.requestClientCredentialsToken.mockRejectedValue(new Error("invalid_scope"));

    await expect(acquireBriefToken(options)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      hint: expect.stringContaining("co.briefs:r"),
    });
  });

  it("includes the underlying error message in the failure hint", async () => {
    authMocks.requestClientCredentialsToken.mockRejectedValue(new Error("auth0 down"));

    await expect(acquireBriefToken(options)).rejects.toMatchObject({
      hint: expect.stringContaining("auth0 down"),
    });
  });

  it("throws AUTH_REQUIRED when the mint succeeds but yields no access token", async () => {
    authMocks.requestClientCredentialsToken.mockResolvedValue({ accessToken: "" });

    await expect(acquireBriefToken(options)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(keychainMocks.setBriefToken).not.toHaveBeenCalled();
  });
});
