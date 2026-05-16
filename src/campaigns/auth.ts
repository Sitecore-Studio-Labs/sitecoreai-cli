import { requestClientCredentialsToken } from "@/serialization/api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/api/types";
import { resolveClientCredential } from "@/shared/client-credential";
import { createScaiError } from "@/shared/errors";
import { getCampaignToken, setCampaignToken } from "@/shared/keychain";

/**
 * Auth seam for the Campaign (Orchestrate) API.
 *
 * **Unverified scope.** The HAR capture this client was built from had
 * its Authorization headers stripped, so the exact OAuth scope the
 * Orchestrate API requires is unknown. The mint below requests **no
 * scope** — Auth0 then grants whatever the M2M client carries, the
 * same permissive pattern the Brief API client-credentials flow uses.
 * Once a scope is confirmed, pin it here. See `docs/campaigns-followups.md`.
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
  envName: string;
  environment: SitecoreApiClientOptions;
}

/**
 * Returns a Bearer JWT for the Sitecore Orchestrate (Campaign) API.
 *
 * Resolution order:
 *   1. Campaign-specific keychain entry, if the cached JWT is unexpired.
 *   2. M2M client-credentials mint. The `clientId` + `clientSecret` are
 *      resolved by `resolveClientCredential` — the shared three-tier
 *      chain: the `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` env-var override,
 *      then the env-scoped automation client in the OS keychain, then
 *      the org-scoped one. The minted token is cached for next time.
 *
 * Refuses with `AUTH_REQUIRED` if neither path yields a token. There is
 * no interactive login flow — campaign calls are agent-driven.
 */
export const acquireCampaignToken = async (
  options: AcquireCampaignTokenOptions
): Promise<string> => {
  const cached = await getCampaignToken(options.envName);
  if (cached && isFresh(cached)) {
    return cached;
  }

  const env = options.environment;
  // The client secret never lives in the config file — `resolveClientCredential`
  // walks the three tiers (env-var override → env-scoped keychain client →
  // org-scoped keychain client) and pairs the secret with the `clientId`
  // it is handed from the config-resident metadata.
  const credential = await resolveClientCredential({
    envName: options.envName,
    clientId: env.clientId,
    automationClientId: env.automationClient?.clientId,
    organizationId: env.organizationId,
    orgClientId: env.orgClientId,
  });

  if (credential && env.authority) {
    try {
      const result = await requestClientCredentialsToken({
        ...env,
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
      });
      if (result.accessToken) {
        await setCampaignToken(options.envName, result.accessToken);
        return result.accessToken;
      }
    } catch (error) {
      throw createScaiError(
        "Could not acquire an Orchestrate-scoped token via client credentials.",
        "AUTH_REQUIRED",
        {
          hint: `Confirm the environment's automation client is authorized for the Orchestrate API. Underlying error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      );
    }
  }

  throw createScaiError(
    "No Orchestrate-scoped token available for this environment.",
    "AUTH_REQUIRED",
    {
      hint: "Provide the environment's automation client — run `scai setup env` to store it in the OS keychain, or set SITECOREAI_ENV_<ENV>_CLIENT_SECRET. The Campaign API does not support interactive operator login.",
    }
  );
};
