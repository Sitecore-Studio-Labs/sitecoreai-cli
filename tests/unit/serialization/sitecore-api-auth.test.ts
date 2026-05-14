import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";

const keychainMocks = vi.hoisted(() => ({
  getCmTokens: vi.fn(),
  setCmTokens: vi.fn(),
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("throws when device login is missing authority or clientId", async () => {
    const { requestDeviceAuthorization } =
      await import("../../../src/serialization/sitecore-api/auth");
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

    const { requestDeviceAuthorization } =
      await import("../../../src/serialization/sitecore-api/auth");
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

    const { requestDeviceAuthorization } =
      await import("../../../src/serialization/sitecore-api/auth");
    await expect(requestDeviceAuthorization(makeEnv())).rejects.toThrow(
      "Failed to start device login (400): bad request"
    );
  });

  it("fails when discovery times out", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } =
      await import("../../../src/serialization/sitecore-api/auth");
    await expect(requestClientCredentialsToken(makeEnv())).rejects.toMatchObject({
      code: "NETWORK",
      message: "Identity discovery timed out.",
    });
  });

  it("handles token endpoint failures with parsed errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { requestClientCredentialsToken } =
      await import("../../../src/serialization/sitecore-api/auth");
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

    const { pollDeviceToken } = await import("../../../src/serialization/sitecore-api/auth");
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

    const { pollDeviceToken } = await import("../../../src/serialization/sitecore-api/auth");
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

    const { pollDeviceToken } = await import("../../../src/serialization/sitecore-api/auth");
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

    const { pollDeviceToken } = await import("../../../src/serialization/sitecore-api/auth");
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

    const { getAccessToken } = await import("../../../src/serialization/sitecore-api/auth");
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

    const { getAccessToken } = await import("../../../src/serialization/sitecore-api/auth");
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

    const { getAccessToken } = await import("../../../src/serialization/sitecore-api/auth");
    const token = await getAccessToken(makeEnv({ useClientCredentials: true }));
    expect(token).toBe("cc-access");
    expect(keychainMocks.setCmTokens).toHaveBeenCalled();
  });
});

describe("acquireAccessToken (pure, no keychain)", () => {
  beforeEach(() => {
    keychainMocks.getCmTokens.mockReset();
    keychainMocks.setCmTokens.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns client-credentials token when useClientCredentials is set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "cc-pure", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/sitecore-api/auth");
    const result = await acquireAccessToken(makeEnv({ useClientCredentials: true }));

    expect(result?.accessToken).toBe("cc-pure");
    expect(result?.expiresIn).toBe(3600);
    // Crucial: keychain MUST NOT be touched.
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("returns refresh-token result when env has a refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://auth.example/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "refreshed", refresh_token: "rt" }));
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/sitecore-api/auth");
    const result = await acquireAccessToken(makeEnv({ refreshToken: "rt-old" }));

    expect(result?.accessToken).toBe("refreshed");
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
    expect(keychainMocks.setCmTokens).not.toHaveBeenCalled();
  });

  it("returns undefined when no acquisition path is available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/sitecore-api/auth");
    // No refreshToken, no useClientCredentials, no accessToken — nothing to do.
    const result = await acquireAccessToken(makeEnv());

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keychainMocks.getCmTokens).not.toHaveBeenCalled();
  });

  it("does NOT return the env's embedded accessToken literal (that's getAccessToken's job)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { acquireAccessToken } = await import("../../../src/serialization/sitecore-api/auth");
    // Embedded accessToken on env — acquireAccessToken does not consider it.
    const result = await acquireAccessToken(makeEnv({ accessToken: "literal" }));

    expect(result).toBeUndefined();
  });
});
