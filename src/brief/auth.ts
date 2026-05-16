import { requestClientCredentialsToken } from "@/serialization/api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/api/types";
import { resolveClientCredential } from "@/shared/client-credential";
import { createScaiError } from "@/shared/errors";
import { getBriefToken, setBriefToken } from "@/shared/keychain";

/**
 * OAuth scopes the Content Operations Brief API requires.
 *
 * Discovered 2026-05-14 by probing the Agents env M2M client:
 *   - `co.briefs:r` — read briefs, brief types, tasks, comments
 *   - `co.briefs:w` — create/update/delete briefs, post tasks/comments
 *
 * The Agents env automation client carries both by default — minting
 * a token with no `scope` parameter still includes `co.briefs:r/w` in
 * the granted claim. Requesting the scopes explicitly is the
 * least-privilege path and the one used here.
 */
export const BRIEF_SCOPES_REQUESTED = ["co.briefs:r", "co.briefs:w"] as const;

const M2M_SCOPE_PARAM = BRIEF_SCOPES_REQUESTED.join(" ");

const SCOPE_DENIED_HINT =
  "Confirm the environment's automation client is authorized in Auth0 for the co.briefs:r and co.briefs:w scopes.";

/**
 * JWT exp claim (seconds since epoch) — used to decide whether a cached
 * token is still usable. We refresh ~60s early to absorb clock skew and
 * in-flight request latency.
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
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp > nowSeconds + skewSeconds;
};

export interface AcquireBriefTokenOptions {
  envName: string;
  environment: SitecoreApiClientOptions;
}

/**
 * Returns a Bearer JWT for the Sitecore Content Operations Brief API.
 *
 * Resolution order:
 *   1. Brief-specific keychain entry, if still valid (JWT not expired).
 *   2. M2M client-credentials mint with `co.briefs:r co.briefs:w`. The
 *      `clientId` + `clientSecret` are resolved by `resolveClientCredential`
 *      — the shared three-tier chain: the
 *      `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` env-var override, then the
 *      env-scoped automation client in the OS keychain, then the
 *      org-scoped one. Result is cached.
 *
 * Refuses with `AUTH_REQUIRED` if neither path yields a token. There
 * is no interactive login flow — Brief calls are always agent-driven.
 */
export const acquireBriefToken = async (options: AcquireBriefTokenOptions): Promise<string> => {
  const cached = await getBriefToken(options.envName);
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
      const result = await requestClientCredentialsToken(
        { ...env, clientId: credential.clientId, clientSecret: credential.clientSecret },
        M2M_SCOPE_PARAM
      );
      if (result.accessToken) {
        await setBriefToken(options.envName, result.accessToken);
        return result.accessToken;
      }
    } catch (error) {
      throw createScaiError(
        "Could not acquire a brief-scoped token via client credentials.",
        "AUTH_REQUIRED",
        {
          hint: `${SCOPE_DENIED_HINT} Underlying error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      );
    }
  }

  throw createScaiError("No brief-scoped token available for this environment.", "AUTH_REQUIRED", {
    hint: "Provide the environment's automation client — run `scai setup env` to store it in the OS keychain, or set SITECOREAI_ENV_<ENV>_CLIENT_SECRET. The Brief API does not support interactive operator login.",
  });
};
