import { createApiAuth } from "@/auth/factory";
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
 *
 * The cache → resolve → mint → cache loop runs through the shared
 * `createApiAuth` factory in `@/auth/factory`; campaign plugs in its
 * own keychain slot (`getCampaignToken` / `setCampaignToken`), no
 * scope parameter (AI APIs keys are minted unfiltered), and a
 * credential resolver that pulls the org-scoped `clientId` from the
 * `brand[orgId]` config block and its secret from the keychain.
 */

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

  const acquire = createApiAuth({
    keychainKey: organizationId,
    getCachedToken: getCampaignToken,
    setCachedToken: setCampaignToken,
    errorCode: "AUTH_BRAND_REQUIRED",
    resolveCredential: async () => {
      const clientSecret = await getBrandClientSecret(organizationId);
      if (!brandCredential?.clientId || !clientSecret) return undefined;
      return {
        clientId: brandCredential.clientId,
        clientSecret,
        authority: brandCredential.authority,
        audience: brandCredential.audience,
      };
    },
    onMissingCredential: () => ({
      message: `No AI APIs key is registered for org '${organizationId}'.`,
      hint: "The Orchestrate (Campaign) API authenticates with the AI APIs key — the same credential `scai brand` uses. Register one with `scai setup client register-brand`.",
    }),
    onMintFailure: (error) => ({
      message: `Failed to acquire campaign token for org '${organizationId}'.`,
      hint: `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    }),
    onNoAccessToken: () => ({
      message: `Sitecore returned no access token for org '${organizationId}'.`,
      hint: "Re-register the AI APIs key with `scai setup client register-brand`.",
    }),
  });
  return acquire();
};
