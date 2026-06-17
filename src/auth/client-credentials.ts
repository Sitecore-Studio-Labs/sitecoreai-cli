import type { SitecoreApiClientOptions } from "./types";
import { getCmTokens, setCmTokens } from "@/shared/keychain";
import { resolveClientCredential } from "@/shared/client-credential";
import { createScaiError } from "@/shared/errors";

const DISCOVERY_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.SITECOREAI_AUTH_DISCOVERY_TIMEOUT_MS ?? 5000)
);

const fetchDiscovery = async (authority: string): Promise<Response> => {
  const url = `${authority.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createScaiError("Identity discovery timed out.", "NETWORK", {
        hint: "Check network connectivity or set SITECOREAI_AUTH_DISCOVERY_TIMEOUT_MS.",
      });
    }
    throw createScaiError(
      `Identity discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      "NETWORK"
    );
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Defense against a tampered OpenID discovery document redirecting OAuth
 * traffic to an attacker-controlled endpoint. The discovery URL is trusted
 * (operator-supplied authority), but the JSON it returns is server-provided
 * data — and a compromised authority could rewrite `token_endpoint` to point
 * elsewhere, harvesting client credentials on every token exchange.
 */
const assertSameHost = (endpointUrl: string, authority: string, label: string): void => {
  let parsedEndpoint: URL;
  let parsedAuthority: URL;
  try {
    parsedEndpoint = new URL(endpointUrl);
    parsedAuthority = new URL(authority);
  } catch {
    throw createScaiError(
      `Discovery document returned an invalid ${label}: ${endpointUrl}.`,
      "NETWORK"
    );
  }
  if (parsedEndpoint.hostname.toLowerCase() !== parsedAuthority.hostname.toLowerCase()) {
    throw createScaiError(
      `Discovery document's ${label} hostname (${parsedEndpoint.hostname}) does not match the authority hostname (${parsedAuthority.hostname}).`,
      "NETWORK",
      {
        hint: "The OpenID discovery document may have been tampered with. Verify the authority URL or reach out to your identity provider.",
      }
    );
  }
};

const getTokenEndpoint = async (authority: string): Promise<string> => {
  const response = await fetchDiscovery(authority);
  if (!response.ok) {
    throw createScaiError(`Failed to discover token endpoint from ${authority}.`, "NETWORK");
  }
  const json = (await response.json()) as {
    token_endpoint?: string;
    device_authorization_endpoint?: string;
  };
  if (!json.token_endpoint) {
    throw createScaiError("Token endpoint not found in discovery document.", "NETWORK");
  }
  assertSameHost(json.token_endpoint, authority, "token_endpoint");
  return json.token_endpoint;
};

const getDeviceAuthorizationEndpoint = async (authority: string): Promise<string> => {
  const response = await fetchDiscovery(authority);
  if (!response.ok) {
    throw createScaiError(
      `Failed to discover device authorization endpoint from ${authority}.`,
      "NETWORK"
    );
  }
  const json = (await response.json()) as { device_authorization_endpoint?: string };
  if (json.device_authorization_endpoint) {
    assertSameHost(json.device_authorization_endpoint, authority, "device_authorization_endpoint");
    return json.device_authorization_endpoint;
  }
  return `${authority.replace(/\/$/, "")}/oauth/device/code`;
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type DeviceAuthorizationResponse = {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  message?: string;
};

export type AccessTokenResult = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
};

export type DeviceAuthorizationResult = {
  deviceCode: string;
  userCode?: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
  message?: string;
};

const requestToken = async (
  authority: string,
  params: URLSearchParams
): Promise<AccessTokenResult> => {
  const tokenEndpoint = await getTokenEndpoint(authority);
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!response.ok) {
    const bodyText = await response.text();
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: string;
        error_description?: string;
        message?: string;
      };
      detail = parsed.error_description ?? parsed.error ?? parsed.message ?? bodyText;
    } catch {
      // keep raw body text
    }
    throw createScaiError(
      `Failed to obtain access token (${response.status}): ${detail || "Unknown error"}`,
      "AUTH_REQUIRED"
    );
  }
  const json = (await response.json()) as OAuthTokenResponse;
  if (!json.access_token) {
    throw createScaiError("Access token was not returned by the identity server.", "AUTH_REQUIRED");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    tokenType: json.token_type,
  };
};

export const requestDeviceAuthorization = async (
  environment: SitecoreApiClientOptions,
  scope?: string
): Promise<DeviceAuthorizationResult> => {
  if (!environment.authority || !environment.clientId) {
    throw createScaiError("Authority and clientId are required for device login.", "AUTH_REQUIRED");
  }
  const endpoint = await getDeviceAuthorizationEndpoint(environment.authority);
  const params = new URLSearchParams({
    client_id: environment.clientId,
  });
  if (environment.audience) {
    params.set("audience", environment.audience);
  }
  if (scope) {
    params.set("scope", scope);
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!response.ok) {
    const bodyText = await response.text();
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: string;
        error_description?: string;
        message?: string;
      };
      detail = parsed.error_description ?? parsed.error ?? parsed.message ?? bodyText;
    } catch {
      // keep raw body text
    }
    throw createScaiError(
      `Failed to start device login (${response.status}): ${detail || "Unknown error"}`,
      "AUTH_REQUIRED"
    );
  }
  const json = (await response.json()) as DeviceAuthorizationResponse;
  if (!json.device_code || !json.verification_uri) {
    throw createScaiError(
      "Device authorization response was missing required fields.",
      "AUTH_REQUIRED"
    );
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    expiresIn: json.expires_in ?? 900,
    interval: json.interval ?? 5,
    message: json.message,
  };
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const pollDeviceToken = async (
  environment: SitecoreApiClientOptions,
  device: DeviceAuthorizationResult
): Promise<AccessTokenResult> => {
  if (!environment.authority || !environment.clientId) {
    throw createScaiError("Authority and clientId are required for device login.", "AUTH_REQUIRED");
  }
  const tokenEndpoint = await getTokenEndpoint(environment.authority);
  const deadline = Date.now() + device.expiresIn * 1000;
  let intervalMs = Math.max(1, device.interval) * 1000;
  while (Date.now() < deadline) {
    const params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.deviceCode,
      client_id: environment.clientId,
    });
    if (environment.clientSecret) {
      params.set("client_secret", environment.clientSecret);
    }
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const bodyText = await response.text();
    if (response.ok) {
      const json = JSON.parse(bodyText) as OAuthTokenResponse;
      if (!json.access_token) {
        throw createScaiError(
          "Access token was not returned by the identity server.",
          "AUTH_REQUIRED"
        );
      }
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresIn: json.expires_in,
        tokenType: json.token_type,
      };
    }
    let errorCode: string | undefined;
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: string;
        error_description?: string;
        message?: string;
      };
      errorCode = parsed.error;
      detail = parsed.error_description ?? parsed.error ?? parsed.message ?? bodyText;
    } catch {
      // keep raw body text
    }
    if (errorCode === "authorization_pending") {
      await delay(intervalMs);
      continue;
    }
    if (errorCode === "slow_down") {
      intervalMs += 5000;
      await delay(intervalMs);
      continue;
    }
    if (errorCode === "access_denied") {
      throw createScaiError("Device login was cancelled.", "AUTH_REQUIRED");
    }
    if (errorCode === "expired_token") {
      throw createScaiError("Device login expired. Try again.", "AUTH_REQUIRED");
    }
    throw createScaiError(
      `Failed to obtain access token (${response.status}): ${detail || "Unknown error"}`,
      "AUTH_REQUIRED"
    );
  }
  throw createScaiError("Device login expired. Try again.", "AUTH_REQUIRED");
};

/**
 * Default OAuth audience for Sitecore Cloud APIs (Deploy + Authoring +
 * Sites). When the env profile doesn't pin an explicit `audience`,
 * Auth0 falls back to whatever default is configured for the M2M
 * client. Some org-scoped clients are configured with internal-only
 * audiences they aren't authorized to mint tokens for, so we always
 * send this audience explicitly on the request.
 */
export const DEFAULT_SITECORE_API_AUDIENCE = "https://api.sitecorecloud.io";

export const requestClientCredentialsToken = async (
  environment: SitecoreApiClientOptions,
  scope?: string
): Promise<AccessTokenResult> => {
  if (!environment.authority || !environment.clientId || !environment.clientSecret) {
    throw createScaiError(
      "Authority, clientId, and clientSecret are required for client credentials.",
      "AUTH_REQUIRED"
    );
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: environment.clientId,
    client_secret: environment.clientSecret,
    audience: environment.audience ?? DEFAULT_SITECORE_API_AUDIENCE,
  });
  if (scope) {
    params.set("scope", scope);
  }

  return requestToken(environment.authority, params);
};

export const requestPasswordToken = async (
  environment: SitecoreApiClientOptions,
  username: string,
  password: string,
  scope?: string
): Promise<AccessTokenResult> => {
  if (!environment.authority || !environment.clientId) {
    throw createScaiError(
      "Authority and clientId are required for username/password login.",
      "AUTH_REQUIRED"
    );
  }

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: environment.clientId,
    username,
    password,
  });
  if (environment.clientSecret) {
    params.set("client_secret", environment.clientSecret);
  }
  if (environment.audience) {
    params.set("audience", environment.audience);
  }
  if (scope) {
    params.set("scope", scope);
  }

  return requestToken(environment.authority, params);
};

const requestRefreshToken = async (
  environment: SitecoreApiClientOptions
): Promise<AccessTokenResult | undefined> => {
  if (!environment.authority || !environment.refreshToken) {
    return undefined;
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: environment.refreshToken,
  });

  if (environment.refreshTokenParameters) {
    for (const [key, value] of Object.entries(environment.refreshTokenParameters)) {
      params.set(key, String(value));
    }
  }

  if (!params.has("client_id") && environment.clientId) {
    params.set("client_id", environment.clientId);
  }
  if (environment.clientSecret) {
    params.set("client_secret", environment.clientSecret);
  }
  if (environment.audience && !params.has("audience")) {
    params.set("audience", environment.audience);
  }

  return requestToken(environment.authority, params);
};

/**
 * Resolve the automation-client secret for a client-credentials mint.
 *
 * Per `docs/credentials.md` the env profile carries no secret. When the
 * caller already supplied a `clientSecret` (a bring-your-own-client pair
 * built by hand), it is used as-is. Otherwise the secret is resolved
 * through the shared three-tier chain (`SITECOREAI_ENV_<ENV>_CLIENT_SECRET`
 * env var → env-scoped keychain client → org-scoped keychain client),
 * keyed by `environment.name`. The matching `clientId` is taken from the
 * same tier that supplies the secret.
 *
 * Returns the environment unchanged when no secret can be resolved — the
 * downstream OAuth call then surfaces the missing-credential error.
 */
const withResolvedClientCredential = async (
  environment: SitecoreApiClientOptions
): Promise<SitecoreApiClientOptions> => {
  if (environment.clientSecret) {
    return environment;
  }
  if (!environment.name) {
    return environment;
  }
  const credential = await resolveClientCredential({
    envName: environment.name,
    clientId: environment.clientId,
    automationClientId: environment.automationClient?.clientId,
    organizationId: environment.organizationId,
    orgClientId: environment.orgClientId,
  });
  if (!credential) {
    return environment;
  }
  return {
    ...environment,
    clientId: credential.clientId,
    clientSecret: credential.clientSecret,
  };
};

/**
 * Pure OAuth acquisition: refresh-token-on-env, then client-credentials.
 * Does NOT touch the keychain token cache, and does NOT return the env's
 * embedded `accessToken` literal — callers wanting the literal-or-acquired
 * union should check `environment.accessToken` themselves first.
 *
 * The client-credentials mint fires whenever a `{ clientId, clientSecret }`
 * pair resolves through the shared three-tier chain — the
 * `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` env var (bring-your-own-client),
 * the env-scoped automation client (`automationClient` block + the
 * `cm-client:<env>` keychain secret), or the org-scoped automation
 * client. A resolvable automation client IS the acquisition path: there
 * is no separate opt-in flag. `useClientCredentials` survives only as a
 * config-file marker for the bring-your-own-client hatch — `setup env`
 * mints an automation client without it, and that client must still
 * work. (This was the bug: the mint was gated on `useClientCredentials`,
 * so a scai-minted automation client could never produce a CM token.)
 *
 * Resolving that pair reads the OS keychain for the long-lived client
 * secret — the one keychain touch here; the short-lived token cache is
 * never read or written by this function (that is `getAccessToken`'s job).
 *
 * Library callers (orchestrators, MCP servers, tests) that bring their
 * own token cache should call this directly. The CLI uses `getAccessToken`
 * which adds keychain-backed caching on top.
 */
export const acquireAccessToken = async (
  environment: SitecoreApiClientOptions
): Promise<AccessTokenResult | undefined> => {
  const refreshed = await requestRefreshToken(environment);
  if (refreshed?.accessToken) {
    return refreshed;
  }
  const resolved = await withResolvedClientCredential(environment);
  if (resolved.clientId && resolved.clientSecret) {
    return requestClientCredentialsToken(resolved);
  }
  return undefined;
};

/**
 * Skew applied to a cached CM token's expiry: a token within this window
 * of expiring is treated as already stale, so it re-mints *before* the
 * request rather than racing the clock and 401-ing mid-flight.
 */
const CM_TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Whether a cached CM token bundle is still safe to use. Freshness is
 * computed from `lastUpdated + expiresIn`. A bundle missing either field
 * (legacy cache entries) is treated as usable — worst case is one 401
 * that the next call recovers from, matching the prior behavior.
 *
 * The expiry check is what makes an empty / stale `cm:` slot self-heal:
 * once the cached token lapses, `getAccessToken` falls through to
 * `acquireAccessToken`, which re-mints from the automation client.
 */
const isCmTokenFresh = (bundle: {
  expiresIn?: number | null;
  lastUpdated?: string | null;
}): boolean => {
  if (!bundle.expiresIn || !bundle.lastUpdated) {
    return true;
  }
  const expiresAt = Date.parse(bundle.lastUpdated) + bundle.expiresIn * 1000;
  if (Number.isNaN(expiresAt)) {
    return true;
  }
  return Date.now() < expiresAt - CM_TOKEN_EXPIRY_SKEW_MS;
};

export const getAccessToken = async (
  environment: SitecoreApiClientOptions
): Promise<string | undefined> => {
  const envName = environment.name;
  const shouldCache = environment.cacheAuthenticationToken !== false && Boolean(envName);
  const cached = shouldCache && envName ? await getCmTokens(envName) : undefined;
  if (cached?.accessToken && isCmTokenFresh(cached)) {
    return cached.accessToken;
  }

  if (cached?.refreshToken) {
    const refreshed = await requestRefreshToken({
      ...environment,
      refreshToken: cached.refreshToken,
      refreshTokenParameters: cached.refreshTokenParameters,
    });
    if (refreshed?.accessToken) {
      if (shouldCache && envName) {
        await setCmTokens(envName, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? cached.refreshToken,
          refreshTokenParameters: cached.refreshTokenParameters,
          expiresIn: refreshed.expiresIn,
          lastUpdated: new Date().toISOString(),
        });
      }
      return refreshed.accessToken;
    }
  }

  if (environment.accessToken) {
    return environment.accessToken;
  }

  const acquired = await acquireAccessToken(environment);
  if (acquired?.accessToken) {
    if (shouldCache && envName) {
      await setCmTokens(envName, {
        accessToken: acquired.accessToken,
        refreshToken: acquired.refreshToken ?? environment.refreshToken,
        refreshTokenParameters: environment.refreshTokenParameters,
        expiresIn: acquired.expiresIn,
        lastUpdated: new Date().toISOString(),
      });
    }
    return acquired.accessToken;
  }

  return undefined;
};
