/**
 * Public configuration shape for Brief API clients. Mirrors
 * `SitesApiClientOptions` — bring your own access token, optionally
 * override the base URL.
 *
 * Unlike Sites (single global host), Brief is regional: hosts follow
 * the `co-brief-api-<region>.sitecorecloud.io` pattern (e.g.
 * `co-brief-api-euw` for EU-West, `co-brief-api-eus` for US-East).
 * Each environment binds to one region. The CLI/recipe layers fill
 * `baseUrl` via the shared region resolver (`@/shared/region` — org id
 * → region); the default below is the fallback for direct library
 * callers and probe scripts that bring no environment.
 */
import { DEFAULT_REGION, regionalHost } from "@/shared/region";

export type BriefApiClientOptions = {
  /** Defaults to the EU-West host. CLI/recipe callers fill it region-aware. */
  baseUrl?: string;
  /** Bearer token from `auth.sitecorecloud.io` — required scopes are TBD pending API discovery. */
  accessToken: string;
};

/** Brief host template — `{region}` is filled by `resolveRegionalBaseUrl`. */
export const BRIEF_API_HOST_TEMPLATE = "https://co-brief-api-{region}.sitecorecloud.io";

/** Fallback host (EU-West) for callers that resolve no region. */
export const DEFAULT_BRIEF_API_BASE = regionalHost(BRIEF_API_HOST_TEMPLATE, DEFAULT_REGION);

/** Per-call options shared by every helper. */
export type BriefRequestInit = {
  method?: string;
  headers?: Record<string, string>;
};

export type BriefQueryValue = string | number | boolean;
export type BriefQueryRecord = Record<string, BriefQueryValue | BriefQueryValue[] | undefined>;
