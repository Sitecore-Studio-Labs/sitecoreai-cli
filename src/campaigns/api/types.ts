/**
 * Public configuration shape for Campaign (Orchestrate) API clients.
 * Mirrors `BriefApiClientOptions` — bring your own access token,
 * optionally override the base URL.
 *
 * The Campaign surface is the Sitecore **Orchestrate API**
 * (`/api/orchestrate/v1/`). A "campaign" in the product UI is an
 * Orchestrate `project`; the SDK keeps the API noun (`project`) so the
 * wire and the code line up — the CLI/MCP layers present it as
 * "campaign".
 *
 * Like the Brief API, Orchestrate is **regional**: hosts follow
 * `ai-workflows-<region>.sitecorecloud.io` (e.g. `ai-workflows-euw`
 * for EU-West). There is no region-agnostic proxy — each environment
 * binds to one region. The CLI/recipe layers fill `baseUrl` via the
 * shared region resolver (`@/shared/region` — org id → region); the
 * default below is the fallback for direct library callers and probe
 * scripts that bring no environment.
 */
import { DEFAULT_REGION, regionalHost } from "@/shared/region";

export type CampaignApiClientOptions = {
  /** Defaults to the EU-West host. CLI/recipe callers fill it region-aware. */
  baseUrl?: string;
  /** Bearer token from `auth.sitecorecloud.io`. Exact scope is TBD pending an authed probe. */
  accessToken: string;
};

/** Orchestrate host template — `{region}` is filled by `resolveRegionalBaseUrl`. */
export const CAMPAIGN_API_HOST_TEMPLATE = "https://ai-workflows-{region}.sitecorecloud.io";

/** Fallback host (EU-West) for callers that resolve no region. */
export const DEFAULT_CAMPAIGN_API_BASE = regionalHost(CAMPAIGN_API_HOST_TEMPLATE, DEFAULT_REGION);

/** Per-call options shared by every helper. */
export type CampaignRequestInit = {
  method?: string;
  headers?: Record<string, string>;
};

export type CampaignQueryValue = string | number | boolean;
export type CampaignQueryRecord = Record<
  string,
  CampaignQueryValue | CampaignQueryValue[] | undefined
>;
