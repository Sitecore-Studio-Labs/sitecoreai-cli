import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiAuth, isTokenFresh, type ApiAuthSpec } from "../../../src/auth/factory";

/**
 * Direct unit coverage for the `src/auth/factory` seam.
 *
 * `createApiAuth` is the shared cache → resolve → mint → validate →
 * cache loop that every OAuth-protected domain area (brief, campaigns,
 * brand, publishing) authenticates through. It mints via the real
 * `requestClientCredentialsToken`, so `fetch` is stubbed with the same
 * `vi.stubGlobal` convention as the sibling auth tests. `getCachedToken`
 * / `setCachedToken` / `resolveCredential` are per-spec callbacks, so
 * they are provided as `vi.fn()` spies rather than mocked modules.
 */

const b64url = (obj: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

/** Forge a minimal (unsigned) JWT with the given scope claim + exp. */
const fakeJwt = (scopes: string[], expSecondsFromNow = 3600): string =>
  `${b64url({ alg: "none" })}.${b64url({
    scope: scopes.join(" "),
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  })}.sig`;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/**
 * The default mint authority is `https://auth.sitecorecloud.io`, so the
 * discovery doc's `token_endpoint` must be on that host to pass the
 * same-host guard in `client-credentials`.
 */
const defaultAuthorityDiscovery = (): Response =>
  jsonResponse({ token_endpoint: "https://auth.sitecorecloud.io/oauth/token" });

/** A spec with sensible defaults; override per test. */
const makeSpec = (overrides: Partial<ApiAuthSpec> = {}): ApiAuthSpec => ({
  keychainKey: "org-1",
  getCachedToken: vi.fn().mockResolvedValue(undefined),
  setCachedToken: vi.fn().mockResolvedValue(true),
  resolveCredential: vi
    .fn()
    .mockResolvedValue({ clientId: "resolved-id", clientSecret: "resolved-secret" }),
  errorCode: "AUTH_REQUIRED",
  onMissingCredential: () => ({ message: "no credential", hint: "run setup" }),
  onMintFailure: (error: unknown) => ({
    message: `mint failed: ${error instanceof Error ? error.message : String(error)}`,
  }),
  onNoAccessToken: () => ({ message: "idp returned no token" }),
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── isTokenFresh ────────────────────────────────────────────────────────────
describe("isTokenFresh", () => {
  it("returns true for a token comfortably beyond the skew window", () => {
    expect(isTokenFresh(fakeJwt([], 3600))).toBe(true);
  });

  it("returns false for an already-expired token", () => {
    expect(isTokenFresh(fakeJwt([], -3600))).toBe(false);
  });

  it("returns false for a token inside the default 60s skew window", () => {
    expect(isTokenFresh(fakeJwt([], 30))).toBe(false);
  });

  it("respects a custom skew argument", () => {
    // 120s of life left is fresh at the default 60s skew but stale at 180s.
    const token = fakeJwt([], 120);
    expect(isTokenFresh(token, 60)).toBe(true);
    expect(isTokenFresh(token, 180)).toBe(false);
  });

  it("returns false for an undecodable / non-JWT value (treated as expired)", () => {
    expect(isTokenFresh("not-a-jwt")).toBe(false);
    expect(isTokenFresh("only.two")).toBe(false);
    expect(isTokenFresh("")).toBe(false);
  });

  it("returns false for a JWT payload with no exp claim", () => {
    const noExp = `${b64url({ alg: "none" })}.${b64url({ scope: "a" })}.sig`;
    expect(isTokenFresh(noExp)).toBe(false);
  });
});

// ── createApiAuth ───────────────────────────────────────────────────────────
describe("createApiAuth — cache path", () => {
  it("returns a fresh cached token without resolving or minting", async () => {
    const cached = fakeJwt(["co.x:r"], 3600);
    const spec = makeSpec({ getCachedToken: vi.fn().mockResolvedValue(cached) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const token = await createApiAuth(spec)();

    expect(token).toBe(cached);
    expect(spec.resolveCredential).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spec.getCachedToken).toHaveBeenCalledWith("org-1");
  });

  it("falls through to a mint when the cached token is expired", async () => {
    const spec = makeSpec({
      getCachedToken: vi.fn().mockResolvedValue(fakeJwt(["co.x:r"], -10)),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: fakeJwt(["co.x:r"], 3600) }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiAuth(spec)();

    expect(spec.resolveCredential).toHaveBeenCalledOnce();
  });

  it("falls through to a mint when the cached value is not a decodable JWT", async () => {
    const spec = makeSpec({ getCachedToken: vi.fn().mockResolvedValue("garbage") });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: fakeJwt([], 3600) }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiAuth(spec)();

    expect(spec.resolveCredential).toHaveBeenCalledOnce();
  });
});

describe("createApiAuth — mint path", () => {
  it("mints with the resolved credential and default authority + audience", async () => {
    const spec = makeSpec();
    const minted = fakeJwt([], 3600);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: minted }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await createApiAuth(spec)();

    expect(token).toBe(minted);
    // Discovery hit the default authority host.
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://auth.sitecorecloud.io/.well-known/openid-configuration"
    );
    const body = (fetchMock.mock.calls[1][1] as { body: string }).body;
    expect(body).toContain("client_id=resolved-id");
    expect(body).toContain("client_secret=resolved-secret");
    // Default audience applied when the credential omits one.
    expect(body).toContain("audience=https%3A%2F%2Fapi.sitecorecloud.io");
    // No scope requested when spec.scopes is unset.
    expect(body).not.toContain("scope=");
  });

  it("mints against the credential's own authority + audience when supplied", async () => {
    const spec = makeSpec({
      resolveCredential: vi.fn().mockResolvedValue({
        clientId: "id",
        clientSecret: "secret",
        authority: "https://auth.custom.io",
        audience: "https://api.custom.io",
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.custom.io/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: fakeJwt([], 3600) }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiAuth(spec)();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://auth.custom.io/.well-known/openid-configuration"
    );
    expect((fetchMock.mock.calls[1][1] as { body: string }).body).toContain(
      "audience=https%3A%2F%2Fapi.custom.io"
    );
  });

  it("passes the spec's scopes param to the mint when set", async () => {
    const spec = makeSpec({ scopes: "co.briefs:r co.briefs:w" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: fakeJwt([], 3600) }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiAuth(spec)();

    expect((fetchMock.mock.calls[1][1] as { body: string }).body).toContain(
      "scope=co.briefs%3Ar+co.briefs%3Aw"
    );
  });

  it("caches the minted token under the keychain key", async () => {
    const spec = makeSpec();
    const minted = fakeJwt([], 3600);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: minted }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiAuth(spec)();

    expect(spec.setCachedToken).toHaveBeenCalledWith("org-1", minted);
  });
});

describe("createApiAuth — required-scope validation", () => {
  it("returns the token when it carries every required scope", async () => {
    const spec = makeSpec({ requiredScopes: ["co.x:r", "co.x:w"] });
    const minted = fakeJwt(["co.x:r", "co.x:w", "co.x:admin"], 3600);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: minted }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await createApiAuth(spec)()).toBe(minted);
    expect(spec.setCachedToken).toHaveBeenCalledWith("org-1", minted);
  });

  it("invokes onMissingScopes with the granted list and throws when a scope is absent", async () => {
    const onMissingScopes = vi.fn().mockReturnValue({
      message: "missing publishing scopes",
      hint: "reprovision client",
    });
    const spec = makeSpec({
      requiredScopes: ["co.x:r", "co.x:w"],
      onMissingScopes,
    });
    const minted = fakeJwt(["co.x:r"], 3600); // missing co.x:w
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: minted }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApiAuth(spec)()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "missing publishing scopes",
      hint: "reprovision client",
    });
    expect(onMissingScopes).toHaveBeenCalledWith(minted, ["co.x:r"]);
    // A token that fails validation is never cached.
    expect(spec.setCachedToken).not.toHaveBeenCalled();
  });

  it("uses a built-in diagnostic message when onMissingScopes is not provided", async () => {
    const spec = makeSpec({ requiredScopes: ["co.x:w"] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: fakeJwt(["co.x:r"], 3600) }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApiAuth(spec)()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("missing required scopes: co.x:w"),
    });
  });
});

describe("createApiAuth — failure branches", () => {
  it("throws the caller's error code + message when no credential resolves", async () => {
    const spec = makeSpec({ resolveCredential: vi.fn().mockResolvedValue(undefined) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApiAuth(spec)()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "no credential",
      hint: "run setup",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps a mint failure via onMintFailure", async () => {
    const spec = makeSpec();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(defaultAuthorityDiscovery())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_scope" }), { status: 400 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApiAuth(spec)()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("mint failed:"),
    });
    expect(spec.setCachedToken).not.toHaveBeenCalled();
  });

  it("honors a non-default error code across every failure branch", async () => {
    const spec = makeSpec({
      errorCode: "AUTH_BRAND_REQUIRED",
      resolveCredential: vi.fn().mockResolvedValue(undefined),
    });
    vi.stubGlobal("fetch", vi.fn());

    await expect(createApiAuth(spec)()).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
  });
});
