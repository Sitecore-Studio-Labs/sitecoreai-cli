import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/sitecore-api/types";
import { createScaiError } from "@/shared/errors";
import { getPublishingToken, setPublishingToken } from "@/shared/keychain";

/**
 * OAuth scopes the SAI Publishing API requires.
 *
 * Per the Publishing API architect (2026-05-14):
 *
 *   - Every Sitecore Cloud **environment** has its own automation
 *     client. Creating one is operator-side (Cloud Portal →
 *     Environments → [env] → Automation Clients).
 *   - Env-level automation clients carry the tenant-tier `.t` scopes
 *     below by default. ORG-level clients do NOT — they carry
 *     `xmclouddeploy.*` for org/project/env management but no
 *     `xmcpub.*` grant.
 *   - The api-docs page lists both `.a` (admin-tier, for Pages-UI
 *     user tokens with Organization Owner role) and `.t` (tenant-
 *     tier, for automation clients). Use `.t` for any M2M flow.
 *
 *   - `xmcpub.jobs.t:r` — read publishing jobs
 *   - `xmcpub.jobs.t:w` — create / cancel publishing jobs
 *   - `xmcpub.queue:r`  — read the publish queue
 *
 * Audience: the standard `https://api.sitecorecloud.io` — same one
 * scai's deploy operations already target. (Pages user tokens use
 * `api-webapp.sitecorecloud.io` for the `.a` admin scopes; that's a
 * different resource server and isn't relevant to automation.)
 */
export const PUBLISHING_SCOPES_REQUESTED = [
  "xmcpub.jobs.t:r",
  "xmcpub.jobs.t:w",
  "xmcpub.queue:r",
] as const;

const M2M_SCOPE_PARAM = PUBLISHING_SCOPES_REQUESTED.join(" ");

const NO_CREDENTIALS_HINT =
  "Provide environment-level automation client credentials for this env. In the Sitecore Cloud Portal: Environments → [env] → Automation Clients → Create. Then either add `clientId` + `clientSecret` to this env's profile in sitecoreai.cli.json, set `SITECOREAI_ENV_<NAME>_CLIENT_ID` + `_CLIENT_SECRET` env vars, or run `scai publish login -n <env>` for an interactive setup.";

export interface AcquirePublishingTokenOptions {
  envName: string;
  environment: SitecoreApiClientOptions;
}

const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
};

const extractScopes = (token: string): string[] => {
  const payload = decodeJwtPayload(token);
  if (!payload) return [];
  const raw =
    typeof payload.scope === "string"
      ? payload.scope
      : Array.isArray(payload.scp)
        ? (payload.scp as unknown[]).join(" ")
        : "";
  return raw.split(/\s+/).filter(Boolean);
};

/**
 * Build a specific, actionable error when a minted token lacks
 * publishing scopes. Decodes the token, names what it DID get, and
 * infers the likely credential class (org-level vs misconfigured)
 * so the operator knows what to fix in the Cloud Portal.
 */
const buildScopeMissingError = (envName: string, token: string): ReturnType<typeof createScaiError> => {
  const granted = extractScopes(token);
  const orgLevelMarkers = granted.filter((s) => s.startsWith("xmclouddeploy."));
  const lookslikeOrg =
    orgLevelMarkers.some((s) => s.includes("organizations:") || s.includes("projects:")) &&
    !granted.some((s) => s.startsWith("xmcpub."));

  const grantSummary = granted.length > 0 ? granted.join(", ") : "(no scope claim in token)";
  const inference = lookslikeOrg
    ? "The credentials look like an ORG-LEVEL automation client (carries org/project management scopes but not xmcpub.*). The Publishing API requires an ENVIRONMENT-LEVEL automation client."
    : "The credentials don't carry the expected publishing scopes for this environment.";

  return createScaiError(
    `Token minted for env '${envName}' but missing publishing scopes. Expected: ${PUBLISHING_SCOPES_REQUESTED.join(", ")}. Granted: ${grantSummary}.`,
    "AUTH_REQUIRED",
    {
      hint: `${inference} In the Sitecore Cloud Portal: Environments → ${envName} → Automation Clients → Create a new client (env-level), then copy its client id and secret into this env's profile or set SITECOREAI_ENV_${envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CLIENT_ID and _CLIENT_SECRET.`,
    }
  );
};

/**
 * Returns a Bearer JWT for the SAI Publishing API.
 *
 * Resolution order:
 *   1. Cached publishing token in the OS keychain (set by a previous
 *      successful mint, or by `scai publish login`). The cached
 *      token is reused until it expires or the cache is cleared.
 *   2. Fresh M2M mint via the env's client credentials, requesting
 *      `xmcpub.jobs.t:r/w` + `xmcpub.queue:r` scopes explicitly.
 *      The result is verified for scope presence and then cached.
 *
 * Refuses with `AUTH_REQUIRED` when neither path yields a working
 * token. Specific hints distinguish "no credentials configured" vs
 * "credentials are present but lack the publishing scope grant".
 */
export const acquirePublishingToken = async (
  options: AcquirePublishingTokenOptions
): Promise<string> => {
  const cached = await getPublishingToken(options.envName);
  if (cached) {
    return cached;
  }

  const env = options.environment;
  if (!env.clientId || !env.clientSecret || !env.authority) {
    throw createScaiError(
      `No publishing token cached for env '${options.envName}' and the env profile lacks the client credentials needed to mint one.`,
      "AUTH_REQUIRED",
      { hint: NO_CREDENTIALS_HINT }
    );
  }

  let result;
  try {
    result = await requestClientCredentialsToken(env, M2M_SCOPE_PARAM);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/granted scopes|not authorized/i.test(detail)) {
      throw createScaiError(
        `Auth0 refused the publishing scope request for env '${options.envName}'.`,
        "AUTH_REQUIRED",
        {
          hint: `Auth0 error: ${detail}. ${NO_CREDENTIALS_HINT}`,
        }
      );
    }
    throw error;
  }

  if (!result.accessToken) {
    throw createScaiError(
      `Sitecore did not return an access token for env '${options.envName}'.`,
      "AUTH_REQUIRED",
      { hint: NO_CREDENTIALS_HINT }
    );
  }

  // Verify the token actually carries the publishing scopes. Auth0
  // sometimes returns a "successful" token that's silently been
  // trimmed of scopes the client wasn't authorized for — better to
  // fail loudly here than to surface a useless 403 from the API.
  const granted = extractScopes(result.accessToken);
  const missing = PUBLISHING_SCOPES_REQUESTED.filter((s) => !granted.includes(s));
  if (missing.length > 0) {
    throw buildScopeMissingError(options.envName, result.accessToken);
  }

  await setPublishingToken(options.envName, result.accessToken);
  return result.accessToken;
};
