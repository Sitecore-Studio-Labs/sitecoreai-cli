import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SitecoreApiClientOptions } from "../../../src/auth/types";

/**
 * Direct unit coverage for the `src/auth/` cross-domain OAuth seam.
 *
 * `src/auth/client-credentials.ts` is the M2M mint, discovery, retry,
 * host-pinning, refresh, password, and device flows every scai domain
 * area authenticates through. It previously had only *indirect*
 * coverage via the `serialization/api/auth` forwarder
 * (`tests/unit/serialization/sitecore-api-auth.test.ts`); this file
 * exercises the implementation module directly.
 *
 * Conventions mirror the sibling auth tests: the OS keychain is mocked
 * with `vi.hoisted` factories, `fetch` is stubbed with `vi.stubGlobal`,
 * and JSON responses are built with the `jsonResponse` helper. No real
 * network, no real keychain.
 */

const keychainMocks = vi.hoisted(() => ({
  getCmTokens: vi.fn(),
  setCmTokens: vi.fn(),
  // Read by `withResolvedClientCredential` → `resolveClientCredential`
  // when the mint resolves a scai-minted automation client.
  getCmClientSecret: vi.fn(),
  getOrgClientSecret: vi.fn(),
}));

vi.mock("../../../src/shared/keychain", () => keychainMocks);

import {
  acquireAccessToken,
  DEFAULT_SITECORE_API_AUDIENCE,
  getAccessToken,
  pollDeviceToken,
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  requestPasswordToken,
} from "../../../src/auth/client-credentials";

const makeEnv = (overrides: Partial<SitecoreApiClientOptions> = {}): SitecoreApiClientOptions => ({
  name: "demo",
  authority: "https://auth.example",
  clientId: "client",
  clientSecret: "secret",
  audience: "https://api.example",
  cacheAuthenticationToken: true,
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** Discovery doc whose `token_endpoint` sits on the authority host. */
const discovery = (extra: Record<string, unknown> = {}): Response =>
  jsonResponse({ token_endpoint: "https://auth.example/token", ...extra });

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, callIndex: number): string =>
  (fetchMock.mock.calls[callIndex][1] as { body: string }).body;

beforeEach(() => {
  keychainMocks.getCmTokens.mockReset();
  keychainMocks.setCmTokens.mockReset().mockResolvedValue(true);
  keychainMocks.getCmClientSecret.mockReset();
  keychainMocks.getOrgClientSecret.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.SITECOREAI_AUTH_DISCOVERY_ATTEMPTS;
  delete process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS;
  delete process.env.SITECOREAI_AUTH_DISCOVERY_TIMEOUT_MS;
});

// ── requestClientCredentialsToken ───────────────────────────────────────────
describe("requestClientCredentialsToken", () => {
  it("throws AUTH_REQUIRED when authority, clientId, or clientSecret is missing", async () => {
    await expect(
      requestClientCredentialsToken(makeEnv({ clientSecret: undefined }))
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Authority, clientId, and clientSecret are required for client credentials.",
    });
  });

  it("discovers the token endpoint then POSTs a well-formed client_credentials body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestClientCredentialsToken(makeEnv(), "co.foo:r co.foo:w");

    expect(result.accessToken).toBe("cc");
    expect(result.expiresIn).toBe(3600);

    // First call is discovery at the well-known path on the authority host.
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://auth.example/.well-known/openid-configuration"
    );
    // Second call is the token POST to the discovered endpoint.
    expect(fetchMock.mock.calls[1][0]).toBe("https://auth.example/token");
    expect((fetchMock.mock.calls[1][1] as { method: string }).method).toBe("POST");
    expect(
      (fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers["Content-Type"]
    ).toBe("application/x-www-form-urlencoded");

    const body = bodyOf(fetchMock, 1);
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_id=client");
    expect(body).toContain("client_secret=secret");
    expect(body).toContain("audience=https%3A%2F%2Fapi.example");
    expect(body).toContain("scope=co.foo%3Ar+co.foo%3Aw");
  });

  it("sends the default Sitecore audience when the env pins none", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc" }));
    vi.stubGlobal("fetch", fetchMock);

    await requestClientCredentialsToken(makeEnv({ audience: undefined }));

    expect(bodyOf(fetchMock, 1)).toContain("audience=https%3A%2F%2Fapi.sitecorecloud.io");
    expect(DEFAULT_SITECORE_API_AUDIENCE).toBe("https://api.sitecorecloud.io");
  });

  it("omits the scope param when no scope is passed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc" }));
    vi.stubGlobal("fetch", fetchMock);

    await requestClientCredentialsToken(makeEnv());

    expect(bodyOf(fetchMock, 1)).not.toContain("scope=");
  });

  it("maps a 4xx token error to AUTH_REQUIRED with the parsed error_description", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error_description: "client is not authorized" }), {
          status: 401,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Failed to obtain access token (401): client is not authorized",
    });
  });

  it("keeps the raw body text when the error response is not JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(new Response("upstream exploded", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Failed to obtain access token (500): upstream exploded",
    });
  });

  it("throws AUTH_REQUIRED when the token response omits access_token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Access token was not returned by the identity server.",
    });
  });
});

// ── OpenID discovery: retry loop ────────────────────────────────────────────
describe("fetchDiscovery — bounded retry loop", () => {
  it("retries a transient 429 then succeeds", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "after-429" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestClientCredentialsToken(makeEnv());

    expect(result.accessToken).toBe("after-429");
    // discovery(429) → discovery(200) → token POST = 3 fetches.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a transient 5xx then succeeds", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "after-502" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestClientCredentialsToken(makeEnv());

    expect(result.accessToken).toBe("after-502");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers from a transient discovery timeout (AbortError) on retry", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "recovered" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestClientCredentialsToken(makeEnv());
    expect(result.accessToken).toBe("recovered");
  });

  it("waits the exponential backoff between attempts (fake timers)", async () => {
    vi.useFakeTimers();
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "300";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("x", { status: 503 }))
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "backoff-ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = requestClientCredentialsToken(makeEnv());
    // Let the first (failed) discovery attempt settle.
    await vi.advanceTimersByTimeAsync(0);
    // Backoff for attempt 1 is retryBaseMs * 2^0 = 300ms; nothing should
    // have retried before it elapses.
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    // Backoff elapsed → second discovery + token POST run.
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.accessToken).toBe("backoff-ok");
  });

  it("gives up after max attempts on a persistent timeout and throws mapped NETWORK", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_ATTEMPTS = "2";
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: "Identity discovery timed out.",
    });
    // Exactly the configured attempt count, no more.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after max attempts on a persistent 5xx (discovery non-ok surfaces)", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_ATTEMPTS = "2";
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("Failed to discover token endpoint from"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a non-abort fetch rejection to a NETWORK failure", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_ATTEMPTS = "1";
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("Identity discovery failed: ECONNREFUSED"),
    });
  });
});

// ── Discovery host-pinning guard (assertSameHost) ───────────────────────────
describe("assertSameHost — discovery document tamper guard", () => {
  it("rejects a token_endpoint on a different host than the authority", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://evil.attacker/token" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("does not match the authority hostname"),
    });
    // The token POST must never fire — credentials are not sent to the
    // foreign host.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unparseable token_endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ token_endpoint: "not a url" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("returned an invalid token_endpoint"),
    });
  });

  it("throws NETWORK when the discovery document has no token_endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ issuer: "https://auth.example" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: "Token endpoint not found in discovery document.",
    });
  });

  it("treats hostname comparison case-insensitively (same host, different case → allowed)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://AUTH.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "case-ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestClientCredentialsToken(makeEnv());
    expect(result.accessToken).toBe("case-ok");
  });
});

// ── requestPasswordToken ────────────────────────────────────────────────────
describe("requestPasswordToken", () => {
  it("throws AUTH_REQUIRED when authority or clientId is missing", async () => {
    await expect(
      requestPasswordToken(makeEnv({ clientId: undefined }), "u", "p")
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Authority and clientId are required for username/password login.",
    });
  });

  it("mints a password-grant token with username, client_secret, audience, and scope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "pw", token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestPasswordToken(makeEnv(), "alice", "s3cret", "openid profile");

    expect(result.accessToken).toBe("pw");
    expect(result.tokenType).toBe("Bearer");
    const body = bodyOf(fetchMock, 1);
    expect(body).toContain("grant_type=password");
    expect(body).toContain("username=alice");
    expect(body).toContain("password=s3cret");
    expect(body).toContain("client_secret=secret");
    expect(body).toContain("audience=https%3A%2F%2Fapi.example");
    expect(body).toContain("scope=openid+profile");
  });

  it("omits audience and scope when the env has no audience and no scope is passed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "pw" }));
    vi.stubGlobal("fetch", fetchMock);

    await requestPasswordToken(makeEnv({ audience: undefined }), "bob", "pw");

    const body = bodyOf(fetchMock, 1);
    expect(body).not.toContain("audience=");
    expect(body).not.toContain("scope=");
  });

  it("maps a token error to AUTH_REQUIRED", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 403 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestPasswordToken(makeEnv(), "u", "p")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Failed to obtain access token (403): invalid_grant",
    });
  });
});

// ── requestDeviceAuthorization ──────────────────────────────────────────────
describe("requestDeviceAuthorization", () => {
  it("throws AUTH_REQUIRED when authority or clientId is missing", async () => {
    await expect(
      requestDeviceAuthorization(makeEnv({ authority: undefined }))
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Authority and clientId are required for device login.",
    });
  });

  it("uses the advertised device_authorization_endpoint and applies field defaults", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ device_authorization_endpoint: "https://auth.example/dc" })
      )
      .mockResolvedValueOnce(
        jsonResponse({ device_code: "dc", verification_uri: "https://verify" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestDeviceAuthorization(makeEnv(), "openid");

    expect(fetchMock.mock.calls[1][0]).toBe("https://auth.example/dc");
    expect(result.deviceCode).toBe("dc");
    expect(result.verificationUri).toBe("https://verify");
    // Defaults applied when the IdP omits interval / expiresIn.
    expect(result.interval).toBe(5);
    expect(result.expiresIn).toBe(900);
    const body = bodyOf(fetchMock, 1);
    expect(body).toContain("client_id=client");
    expect(body).toContain("scope=openid");
  });

  it("falls back to the /oauth/device/code endpoint when discovery omits it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(
        jsonResponse({ device_code: "dc", verification_uri: "https://verify" })
      );
    vi.stubGlobal("fetch", fetchMock);

    await requestDeviceAuthorization(makeEnv());

    expect(fetchMock.mock.calls[1][0]).toBe("https://auth.example/oauth/device/code");
  });

  it("rejects a device_authorization_endpoint on a foreign host (SSRF guard)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ device_authorization_endpoint: "https://evil.host/dc" })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestDeviceAuthorization(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("does not match the authority hostname"),
    });
  });

  it("maps a device-start error to AUTH_REQUIRED with the parsed detail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ device_authorization_endpoint: "https://auth.example/dc" })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error_description: "bad request" }), { status: 400 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestDeviceAuthorization(makeEnv())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Failed to start device login (400): bad request",
    });
  });

  it("throws AUTH_REQUIRED when the device response is missing required fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ device_authorization_endpoint: "https://auth.example/dc" })
      )
      .mockResolvedValueOnce(jsonResponse({ user_code: "ABCD" })); // no device_code / verification_uri
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestDeviceAuthorization(makeEnv())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Device authorization response was missing required fields.",
    });
  });
});

// ── pollDeviceToken ─────────────────────────────────────────────────────────
describe("pollDeviceToken", () => {
  const device = {
    deviceCode: "device",
    verificationUri: "https://verify",
    expiresIn: 30,
    interval: 1,
  };

  it("throws AUTH_REQUIRED when authority or clientId is missing", async () => {
    await expect(pollDeviceToken(makeEnv({ clientId: undefined }), device)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Authority and clientId are required for device login.",
    });
  });

  it("polls through authorization_pending until the token is granted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "token", refresh_token: "refresh", expires_in: 60 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollDeviceToken(makeEnv(), device);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.accessToken).toBe("token");
    expect(result.refreshToken).toBe("refresh");
    // The token POST carries the device_code grant + client_secret.
    const body = bodyOf(fetchMock, 1);
    expect(body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
    expect(body).toContain("device_code=device");
    expect(body).toContain("client_secret=secret");
  });

  it("backs off further on slow_down before eventually succeeding", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollDeviceToken(makeEnv(), device);
    // interval(1s) + slow_down bump(5s) = 6s before the next poll.
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result.accessToken).toBe("token");
  });

  it("throws when the device login is cancelled (access_denied)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "access_denied" }), { status: 400 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollDeviceToken(makeEnv(), device)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Device login was cancelled.",
    });
  });

  it("throws when the device code has expired (expired_token)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "expired_token" }), { status: 400 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollDeviceToken(makeEnv(), device)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Device login expired. Try again.",
    });
  });

  it("surfaces an unrecognized error code as AUTH_REQUIRED", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollDeviceToken(makeEnv(), device)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Failed to obtain access token (401): invalid_client",
    });
  });

  it("throws AUTH_REQUIRED when a 200 poll response carries no access_token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollDeviceToken(makeEnv(), device)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Access token was not returned by the identity server.",
    });
  });

  it("throws expired when the poll deadline passes without a grant", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(discovery());
    vi.stubGlobal("fetch", fetchMock);

    // expiresIn 0 → deadline is already in the past, so the while-loop
    // body never runs and the expiry error surfaces immediately.
    await expect(pollDeviceToken(makeEnv(), { ...device, expiresIn: 0 })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Device login expired. Try again.",
    });
  });
});

// ── acquireAccessToken (pure — no token cache) ──────────────────────────────
describe("acquireAccessToken", () => {
  it("prefers a refresh-token mint when the env carries a refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "rt-token" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await acquireAccessToken(makeEnv({ refreshToken: "stored-rt" }));

    expect(result?.accessToken).toBe("rt-token");
    expect(bodyOf(fetchMock, 1)).toContain("grant_type=refresh_token");
    // The pure acquirer never touches the token cache.
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("mints via client credentials when the env carries a clientId + secret", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc-pure", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await acquireAccessToken(makeEnv());

    expect(result?.accessToken).toBe("cc-pure");
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("mints from a scai-minted automation client resolved via the keychain", async () => {
    keychainMocks.getCmClientSecret.mockResolvedValue("automation-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "cm-from-client" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await acquireAccessToken(
      makeEnv({
        clientId: undefined,
        clientSecret: undefined,
        automationClient: { clientId: "automation-client-id" },
      })
    );

    expect(result?.accessToken).toBe("cm-from-client");
    expect(keychainMocks.getCmClientSecret).toHaveBeenCalledWith("demo");
  });

  it("returns undefined when no acquisition path is available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await acquireAccessToken(
      makeEnv({ clientId: undefined, clientSecret: undefined })
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not consider the env's embedded accessToken literal", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await acquireAccessToken(
      makeEnv({ accessToken: "literal", clientId: undefined, clientSecret: undefined })
    );

    expect(result).toBeUndefined();
  });
});

// ── getAccessToken (mint + cache) ───────────────────────────────────────────
describe("getAccessToken — cache + freshness", () => {
  it("returns a cached token that is still within its expiry window (no fetch)", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({
      accessToken: "fresh-cached",
      expiresIn: 86400,
      lastUpdated: new Date().toISOString(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(makeEnv());

    expect(token).toBe("fresh-cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a legacy cached token (no expiresIn / lastUpdated) as fresh", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({ accessToken: "legacy" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAccessToken(makeEnv())).toBe("legacy");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a cached token with an unparseable lastUpdated as fresh", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({
      accessToken: "weird-date",
      expiresIn: 3600,
      lastUpdated: "not-a-date",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAccessToken(makeEnv())).toBe("weird-date");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-mints when the cached token has lapsed (expiry self-heal) and persists the fresh token", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({
      accessToken: "stale",
      expiresIn: 60,
      lastUpdated: new Date(Date.now() - 3 * 60_000).toISOString(),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-cm", expires_in: 86400 }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(makeEnv());

    expect(token).toBe("fresh-cm");
    expect(keychainMocks.setCmTokens).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({ accessToken: "fresh-cm", expiresIn: 86400 })
    );
  });

  it("treats a token inside the 60s expiry-skew window as stale and re-mints", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({
      accessToken: "about-to-expire",
      expiresIn: 30, // 30s of life left — inside the 60s skew
      lastUpdated: new Date().toISOString(),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "reminted" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAccessToken(makeEnv())).toBe("reminted");
  });

  it("refreshes a cached refresh token and updates the keychain", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({
      refreshToken: "refresh",
      refreshTokenParameters: { custom: "1" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "new-access", refresh_token: "new-refresh" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(makeEnv());

    expect(token).toBe("new-access");
    expect(keychainMocks.setCmTokens).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        refreshTokenParameters: { custom: "1" },
      })
    );
  });

  it("returns the env's embedded accessToken when cache + refresh are empty", async () => {
    keychainMocks.getCmTokens.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(
      makeEnv({ accessToken: "embedded", clientId: undefined, clientSecret: undefined })
    );

    expect(token).toBe("embedded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("acquires + caches via client credentials when nothing else resolves", async () => {
    keychainMocks.getCmTokens.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "acquired", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(makeEnv());

    expect(token).toBe("acquired");
    expect(keychainMocks.setCmTokens).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({ accessToken: "acquired" })
    );
  });

  it("does not read or write the keychain cache when cacheAuthenticationToken is false", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({ accessToken: "should-not-be-used" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discovery())
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh" }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(makeEnv({ cacheAuthenticationToken: false }));

    expect(token).toBe("fresh");
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("returns undefined when there is no cache, refresh, literal, or acquisition path", async () => {
    keychainMocks.getCmTokens.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken(
      makeEnv({ clientId: undefined, clientSecret: undefined, name: undefined })
    );

    expect(token).toBeUndefined();
  });
});
