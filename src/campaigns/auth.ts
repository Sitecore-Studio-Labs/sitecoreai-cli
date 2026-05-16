import {
  DEFAULT_SITECORE_API_AUDIENCE,
  requestClientCredentialsToken,
} from "@/serialization/api/auth";
import type { BrandCredential } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { getBrandClientSecret, getCampaignToken, setCampaignToken } from "@/shared/keychain";

/**
 * Auth seam for the Campaign (Orchestrate) API.
 *
 * The Orchestrate API is an AI API (`ai-workflows-*.sitecorecloud.io`) and
 * authenticates with the **AI APIs key** — the same org-scoped credential
 * `scai brand` uses (`brand[orgId]` in the config; secret in the keychain).
 *
 * Verified 2026-05-16: a token minted from the AI APIs key calls
 * `/api/orchestrate/v1/projects` successfully, where a Deploy-clients-API
 * automation client (`cm` or `deploy` type) gets `403 Insufficient scope`
 * — those clients carry `xmcloud*`/`co.*` scopes, not the `ai.*` family
 * the Orchestrate API requires.
 *
 * Minted with no `scope` parameter — Auth0 issues the AI APIs key's full
 * (per-key) grant; the Orchestrate API enforces scope server-side. There
 * is no interactive login flow — campaign calls are agent-driven.
 */

/**
 * JWT exp claim (seconds) — used to decide whether a cached token is
 * still usable. Refresh ~60s early to absorb clock skew.
 */
const decodeExp = (jwt: string): number | undefined => {
  const parts = jwt.split(".");
  if (parts.length < 2) return undefined;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
};

const isFresh = (jwt: string, skewSeconds = 60): boolean => {
  const exp = decodeExp(jwt);
  if (exp === undefined) return false;
  return exp > Math.floor(Date.now() / 1000) + skewSeconds;
};

export interface AcquireCampaignTokenOptions {
  /** Org id behind the campaign environment — keys the AI APIs key. */
  organizationId: string | undefined;
  /** The `brand[orgId]` AI APIs key block from the root config. */
  brandCredential: BrandCredential | undefined;
}

/**
 * Returns a Bearer JWT for the Sitecore Orchestrate (Campaign) API.
 *
 * Resolution order:
 *   1. Campaign-specific keychain entry (keyed by org id), if unexpired.
 *   2. Fresh M2M client-credentials mint from the org's AI APIs key —
 *      `clientId` from the `brand[orgId]` config block, secret from the
 *      keychain. Cached for next time.
 *
 * Refuses with `AUTH_BRAND_REQUIRED` when no AI APIs key is registered.
 */
export const acquireCampaignToken = async (
  options: AcquireCampaignTokenOptions
): Promise<string> => {
  const { organizationId, brandCredential } = options;
  if (!organizationId) {
    throw createScaiError(
      "Campaign auth needs the environment's organizationId.",
      "AUTH_BRAND_REQUIRED",
      { hint: "Set organizationId on the env profile, or run `scai setup init`." }
    );
  }

  const cached = await getCampaignToken(organizationId);
  if (cached && isFresh(cached)) {
    return cached;
  }

  const clientSecret = await getBrandClientSecret(organizationId);
  if (!brandCredential?.clientId || !clientSecret) {
    throw createScaiError(
      `No AI APIs key is registered for org '${organizationId}'.`,
      "AUTH_BRAND_REQUIRED",
      {
        hint: "The Orchestrate (Campaign) API authenticates with the AI APIs key — the same credential `scai brand` uses. Register one with `scai setup client register-brand`.",
      }
    );
  }

  const result = await requestClientCredentialsToken({
    authority: brandCredential.authority ?? "https://auth.sitecorecloud.io",
    clientId: brandCredential.clientId,
    clientSecret,
    audience: brandCredential.audience ?? DEFAULT_SITECORE_API_AUDIENCE,
  });
  if (!result.accessToken) {
    throw createScaiError(
      `Sitecore returned no access token for org '${organizationId}'.`,
      "AUTH_BRAND_REQUIRED",
      { hint: "Re-register the AI APIs key with `scai setup client register-brand`." }
    );
  }
  await setCampaignToken(organizationId, result.accessToken);
  return result.accessToken;
};
