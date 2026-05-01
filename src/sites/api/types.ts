/**
 * Public configuration shape for Sites API clients. Mirrors
 * `DeployApiClientOptions` so callers feel consistent across scai's
 * API clients — bring your own access token (minted via the shared
 * OAuth client-credentials helper) and optionally override the base
 * URL for testing.
 */
export type SitesApiClientOptions = {
  /** Defaults to `https://xmapps-api.sitecorecloud.io`. */
  baseUrl?: string;
  /** Bearer token from `auth.sitecorecloud.io` (audience `https://api.sitecorecloud.io`, scope `xmcloud.cm:admin`). */
  accessToken: string;
};

export const DEFAULT_SITES_API_BASE = "https://xmapps-api.sitecorecloud.io";

/**
 * Per-call options shared by every helper. Mirrors `DeployRequestInit`
 * (less the body field — request body shape varies per operation and
 * is typed at the helper level).
 */
export type SitesRequestInit = {
  /** Override the HTTP method. Defaults are baked into each helper. */
  method?: string;
  /** Extra headers; merged on top of the default `Authorization` + `Accept`. */
  headers?: Record<string, string>;
};

/** Query-value shape — Sites API operations either take no query params or simple key/value pairs. */
export type SitesQueryValue = string | number | boolean;
export type SitesQueryRecord = Record<string, SitesQueryValue | SitesQueryValue[] | undefined>;
