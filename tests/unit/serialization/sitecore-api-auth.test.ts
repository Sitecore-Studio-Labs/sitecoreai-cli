import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";

const keychainMocks = vi.hoisted(() => ({
  getCmTokens: vi.fn(),
  setCmTokens: vi.fn(),
  // Read by `withResolvedClientCredential` (via `resolveClientCredential`)
  // when `acquireAccessToken` mints from a scai-minted automation client.
  getCmClientSecret: vi.fn(),
  getOrgClientSecret: vi.fn(),
}));

vi.mock("../../../src/shared/keychain", () => keychainMocks);

const makeEnv = (overrides: Partial<EnvironmentConfiguration> = {}): EnvironmentConfiguration => ({
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

describe("sitecore api auth", () => {
  beforeEach(() => {
    keychainMocks.getCmTokens.mockReset();
    keychainMocks.setCmTokens.mockReset();
    keychainMocks.getCmClientSecret.mockReset();
    keychainMocks.getOrgClientSecret.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.SITECOREAI_AUTH_DISCOVERY_ATTEMPTS;
    delete process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS;
  });

  it("throws when device login is missing authority or clientId", async () => {
    const { requestDeviceAuthorization } = await import("../../../src/serialization/api/auth");
    await expect(requestDeviceAuthorization({} as EnvironmentConfiguration)).rejects.toThrow(
      "Authority and clientId are required for device login."
    );
  });

  it("falls back to default device endpoint when discovery omits it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device",
          verification_uri: "https://verify",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { requestDeviceAuthorization } = await import("../../../src/serialization/api/auth");
    await requestDeviceAuthorization(makeEnv(), "openid");

    expect(fetchMock.mock.calls[1][0]).toBe("https://auth.example/oauth/device/code");
  });

  it("surfaces device authorization errors with details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ device_authorization_endpoint: "https://auth.example/dc" })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error_description: "bad request" }), { status: 400 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { requestDeviceAuthorization } = await import("../../../src/serialization/api/auth");
    await expect(requestDeviceAuthorization(makeEnv())).rejects.toThrow(
      "Failed to start device login (400): bad request"
    );
  });

  it("fails when discovery times out after exhausting retries", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_ATTEMPTS = "2";
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    // Every attempt times out.
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: "Identity discovery timed out.",
    });
    // Retried up to the configured attempt count before giving up.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries identity discovery and recovers from a transient timeout", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi
      .fn()
      // Attempt 1: discovery times out.
      .mockRejectedValueOnce(abortError)
      // Attempt 2: discovery succeeds.
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      // Token exchange succeeds.
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    const result = await requestClientCredentialsToken(makeEnv());
    expect(result.accessToken).toBe("tok");
  });

  it("handles token endpoint failures with parsed errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await expect(requestClientCredentialsToken(makeEnv())).rejects.toThrow(
      "Failed to obtain access token (401): invalid_client"
    );
  });

  it("polls device token until authorization completes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "token", refresh_token: "refresh", expires_in: 60 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { pollDeviceToken } = await import("../../../src/serialization/api/auth");
    const device = {
      deviceCode: "device",
      verificationUri: "https://verify",
      expiresIn: 30,
      interval: 1,
    };

    const promise = pollDeviceToken(makeEnv(), device);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.accessToken).toBe("token");
  });

  it("slows down polling when asked", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }));
    vi.stubGlobal("fetch", fetchMock);

    const { pollDeviceToken } = await import("../../../src/serialization/api/auth");
    const device = {
      deviceCode: "device",
      verificationUri: "https://verify",
      expiresIn: 30,
      interval: 1,
    };

    const promise = pollDeviceToken(makeEnv(), device);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result.accessToken).toBe("token");
  });

  it("handles device denial and expiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "access_denied" }), { status: 400 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { pollDeviceToken } = await import("../../../src/serialization/api/auth");
    const device = {
      deviceCode: "device",
      verificationUri: "https://verify",
      expiresIn: 30,
      interval: 1,
    };
    await expect(pollDeviceToken(makeEnv(), device)).rejects.toThrow("Device login was cancelled.");

    fetchMock.mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "expired_token" }), { status: 400 })
    );
    await expect(pollDeviceToken(makeEnv(), device)).rejects.toThrow(
      "Device login expired. Try again."
    );
  });

  it("throws when token responses are missing access tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const { pollDeviceToken } = await import("../../../src/serialization/api/auth");
    const device = {
      deviceCode: "device",
      verificationUri: "https://verify",
      expiresIn: 30,
      interval: 1,
    };
    await expect(pollDeviceToken(makeEnv(), device)).rejects.toThrow(
      "Access token was not returned by the identity server."
    );
  });

  it("uses cached tokens before refreshing or requesting", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({ accessToken: "cached" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(makeEnv());
    expect(token).toBe("cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes cached tokens and updates the keychain", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({
      refreshToken: "refresh",
      refreshTokenParameters: { custom: "1" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "new-access", refresh_token: "new-refresh" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
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

  it("falls back to client credentials when configured", async () => {
    keychainMocks.getCmTokens.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc-access" }));
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(makeEnv({ useClientCredentials: true }));
    expect(token).toBe("cc-access");
    expect(keychainMocks.setCmTokens).toHaveBeenCalled();
  });

  it("self-heals an empty cm: slot by minting from a scai-minted automation client", async () => {
    // The reported bug: `setup env` minted an automation client, but the
    // CM token slot is empty and there is no `useClientCredentials` flag.
    keychainMocks.getCmTokens.mockResolvedValue(undefined);
    keychainMocks.getCmClientSecret.mockResolvedValue("automation-secret");
    keychainMocks.setCmTokens.mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "minted-cm", expires_in: 86400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(
      makeEnv({
        clientId: undefined,
        clientSecret: undefined,
        automationClient: { clientId: "automation-client-id" },
      })
    );
    expect(token).toBe("minted-cm");
    expect(keychainMocks.getCmClientSecret).toHaveBeenCalledWith("demo");
    expect(keychainMocks.setCmTokens).toHaveBeenCalled();
  });

  it("re-mints when the cached cm: token has expired", async () => {
    // Cached token: 60s lifetime, last refreshed 3 minutes ago — stale.
    keychainMocks.getCmTokens.mockResolvedValue({
      accessToken: "stale-cm",
      expiresIn: 60,
      lastUpdated: new Date(Date.now() - 3 * 60_000).toISOString(),
    });
    keychainMocks.getCmClientSecret.mockResolvedValue("automation-secret");
    keychainMocks.setCmTokens.mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-cm", expires_in: 86400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(
      makeEnv({
        clientId: undefined,
        clientSecret: undefined,
        automationClient: { clientId: "automation-client-id" },
      })
    );
    expect(token).toBe("fresh-cm");
  });

  it("uses a cached cm: token that is still within its expiry window", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({
      accessToken: "fresh-cached",
      expiresIn: 86400,
      lastUpdated: new Date().toISOString(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(makeEnv());
    expect(token).toBe("fresh-cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("acquireAccessToken (pure, no token cache)", () => {
  beforeEach(() => {
    keychainMocks.getCmTokens.mockReset();
    keychainMocks.setCmTokens.mockReset();
    keychainMocks.getCmClientSecret.mockReset();
    keychainMocks.getOrgClientSecret.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints a client-credentials token when the env carries a clientId + secret", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc-pure", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/api/auth");
    const result = await acquireAccessToken(makeEnv({ useClientCredentials: true }));

    expect(result?.accessToken).toBe("cc-pure");
    expect(result?.expiresIn).toBe(3600);
    // The token cache MUST NOT be touched — acquireAccessToken is pure.
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("mints from a scai-minted automation client with no useClientCredentials flag", async () => {
    // The fix: a scai-minted automation client (automationClient block +
    // cm-client:<env> keychain secret) is a valid acquisition path on its
    // own — it does not need the bring-your-own-client flag.
    keychainMocks.getCmClientSecret.mockResolvedValue("automation-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "cm-from-client", expires_in: 86400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/api/auth");
    const result = await acquireAccessToken(
      makeEnv({
        clientId: undefined,
        clientSecret: undefined,
        automationClient: { clientId: "automation-client-id" },
      })
    );

    expect(result?.accessToken).toBe("cm-from-client");
    expect(keychainMocks.getCmClientSecret).toHaveBeenCalledWith("demo");
    // The token cache is still untouched — only the long-lived client
    // secret is read.
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("returns refresh-token result when env has a refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "refreshed", refresh_token: "rt" }));
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/api/auth");
    const result = await acquireAccessToken(makeEnv({ refreshToken: "rt-old" }));

    expect(result?.accessToken).toBe("refreshed");
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("returns undefined when no acquisition path is available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/api/auth");
    // No refreshToken, no resolvable client credential, no accessToken —
    // nothing to do. (`makeEnv` defaults a clientId+secret, so they are
    // explicitly cleared here: a resolvable pair IS an acquisition path.)
    const result = await acquireAccessToken(
      makeEnv({ clientId: undefined, clientSecret: undefined })
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
  });

  it("does NOT return the env's embedded accessToken literal (that's getAccessToken's job)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/api/auth");
    // Embedded accessToken on env — acquireAccessToken does not consider it.
    const result = await acquireAccessToken(
      makeEnv({ accessToken: "literal", clientId: undefined, clientSecret: undefined })
    );

    expect(result).toBeUndefined();
  });

  it("prefers a refresh-token mint over client credentials when the env carries a refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "rt-token" }));
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/api/auth");
    const result = await acquireAccessToken(makeEnv({ refreshToken: "stored-rt" }));

    expect(result?.accessToken).toBe("rt-token");
    // The refresh-token request body carries grant_type=refresh_token.
    expect((fetchMock.mock.calls[1][1] as { body: string }).body).toContain(
      "grant_type=refresh_token"
    );
  });

  it("merges refreshTokenParameters into the refresh request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "rt2" }));
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/api/auth");
    await acquireAccessToken(
      makeEnv({ refreshToken: "stored-rt", refreshTokenParameters: { resource: "xmc" } })
    );

    expect((fetchMock.mock.calls[1][1] as { body: string }).body).toContain("resource=xmc");
  });
});

describe("requestPasswordToken", () => {
  beforeEach(() => {
    keychainMocks.getCmTokens.mockReset();
    keychainMocks.setCmTokens.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when authority or clientId is missing", async () => {
    const { requestPasswordToken } = await import("../../../src/serialization/api/auth");
    await expect(requestPasswordToken({} as EnvironmentConfiguration, "u", "p")).rejects.toThrow(
      "Authority and clientId are required for username/password login."
    );
  });

  it("mints a password-grant token and includes audience + scope in the request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "pw-token", token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestPasswordToken } = await import("../../../src/serialization/api/auth");
    const result = await requestPasswordToken(makeEnv(), "alice", "secret", "openid profile");

    expect(result.accessToken).toBe("pw-token");
    expect(result.tokenType).toBe("Bearer");
    const body = (fetchMock.mock.calls[1][1] as { body: string }).body;
    expect(body).toContain("grant_type=password");
    expect(body).toContain("username=alice");
    expect(body).toContain("audience=");
    expect(body).toContain("scope=openid");
  });

  it("omits audience and scope when the env has no audience and no scope is passed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "pw-token" }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestPasswordToken } = await import("../../../src/serialization/api/auth");
    await requestPasswordToken(makeEnv({ audience: undefined }), "bob", "pw");

    const body = (fetchMock.mock.calls[1][1] as { body: string }).body;
    expect(body).not.toContain("audience=");
    expect(body).not.toContain("scope=");
  });
});

describe("requestClientCredentialsToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when authority, clientId, or clientSecret is missing", async () => {
    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await expect(
      requestClientCredentialsToken(makeEnv({ clientSecret: undefined }))
    ).rejects.toThrow("Authority, clientId, and clientSecret are required for client credentials.");
  });

  it("uses the default Sitecore audience when the env pins none", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc" }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await requestClientCredentialsToken(makeEnv({ audience: undefined }));

    const body = (fetchMock.mock.calls[1][1] as { body: string }).body;
    expect(body).toContain("audience=https%3A%2F%2Fapi.sitecorecloud.io");
  });
});

describe("discovery document hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a token_endpoint whose hostname differs from the authority (tamper guard)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://evil.attacker/token" }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("does not match the authority hostname"),
    });
  });

  it("rejects a discovery document with an unparseable token_endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ token_endpoint: "not a url" }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringContaining("returned an invalid token_endpoint"),
    });
  });

  it("throws NETWORK when the discovery document omits a token_endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ issuer: "https://auth.example" }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await expect(requestClientCredentialsToken(makeEnv())).rejects.toThrow(
      "Token endpoint not found in discovery document."
    );
  });

  it("throws NETWORK when the discovery endpoint persistently responds non-ok", async () => {
    process.env.SITECOREAI_AUTH_DISCOVERY_ATTEMPTS = "2";
    process.env.SITECOREAI_AUTH_DISCOVERY_RETRY_MS = "0";
    // A 5xx is retried; a persistent one surfaces after the attempts run out.
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } = await import("../../../src/serialization/api/auth");
    await expect(requestClientCredentialsToken(makeEnv())).rejects.toThrow(
      "Failed to discover token endpoint from"
    );
  });

  it("uses the device_authorization_endpoint advertised by the discovery document", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ device_authorization_endpoint: "https://auth.example/dc" })
      )
      .mockResolvedValueOnce(
        jsonResponse({ device_code: "dc", verification_uri: "https://verify" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { requestDeviceAuthorization } = await import("../../../src/serialization/api/auth");
    const result = await requestDeviceAuthorization(makeEnv());

    expect(fetchMock.mock.calls[1][0]).toBe("https://auth.example/dc");
    expect(result.deviceCode).toBe("dc");
    // Defaults are applied for absent interval / expiresIn.
    expect(result.interval).toBe(5);
    expect(result.expiresIn).toBe(900);
  });

  it("rejects a device_authorization_endpoint on a foreign host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ device_authorization_endpoint: "https://evil.host/dc" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { requestDeviceAuthorization } = await import("../../../src/serialization/api/auth");
    await expect(requestDeviceAuthorization(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
    });
  });
});

describe("getAccessToken — fallthrough paths", () => {
  beforeEach(() => {
    keychainMocks.getCmTokens.mockReset();
    keychainMocks.setCmTokens.mockReset();
    keychainMocks.getCmClientSecret.mockReset();
    keychainMocks.getOrgClientSecret.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the env's embedded accessToken when the cache is empty and no refresh exists", async () => {
    keychainMocks.getCmTokens.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(
      makeEnv({ accessToken: "embedded", clientId: undefined, clientSecret: undefined })
    );

    expect(token).toBe("embedded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined when no cache, no refresh, no literal, and no acquisition path exist", async () => {
    keychainMocks.getCmTokens.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(
      makeEnv({ clientId: undefined, clientSecret: undefined, name: undefined })
    );

    expect(token).toBeUndefined();
  });

  it("does not read the keychain cache when cacheAuthenticationToken is false", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({ accessToken: "should-not-be-used" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh" }));
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(makeEnv({ cacheAuthenticationToken: false }));

    expect(token).toBe("fresh");
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("treats a legacy cached token (no expiresIn / lastUpdated) as fresh", async () => {
    keychainMocks.getCmTokens.mockResolvedValue({ accessToken: "legacy" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(makeEnv());

    expect(token).toBe("legacy");
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

    const { getAccessToken } = await import("../../../src/serialization/api/auth");
    const token = await getAccessToken(makeEnv());

    expect(token).toBe("weird-date");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
