import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/sitecore-api/types";
import { createScaiError } from "@/shared/errors";
import { getPublishingToken, setPublishingToken } from "@/shared/keychain";

/**
 * OAuth scopes the SAI Publishing API requires.
 *
 * Per the Publishing API architect (2026-05-14): the same automation
 * client an operator uses for `scai deploy` carries these scopes by
 * default. The earlier confusion was scope-variant: the api-docs
 * page lists both `.a` (admin / org-level, what Pages user tokens
 * carry) and `.t` (tenant / automation-client level) variants. Use
 * the `.t` variants for M2M tokens.
 *
 *   - `xmcpub.jobs.t:r` — read publishing jobs (GET /jobs, /jobs/{id})
 *   - `xmcpub.jobs.t:w` — create / cancel publishing jobs
 *     (POST /jobs, POST /jobs/{jobId}/cancel)
 *   - `xmcpub.queue:r`  — read the publish queue (GET /jobs/filters,
 *     /jobs/summary, etc.)
 *
 * Audience: the standard Sitecore Cloud API audience
 * `https://api.sitecorecloud.io` — same one the deploy automation
 * client already targets. Tokens are stored under a publishing-
 * specific keychain key so re-using the same audience doesn't blow
 * away the cached deploy/CM token (different scope set).
 */
export const PUBLISHING_SCOPES_REQUESTED = [
  "xmcpub.jobs.t:r",
  "xmcpub.jobs.t:w",
  "xmcpub.queue:r",
] as const;

const M2M_SCOPE_PARAM = PUBLISHING_SCOPES_REQUESTED.join(" ");

const NO_CREDENTIALS_HINT =
  "Provide the automation client's client id and secret — either via the env profile in sitecoreai.cli.json, via SITECOREAI_ENV_<NAME>_CLIENT_ID / SITECOREAI_ENV_<NAME>_CLIENT_SECRET, or via `scai publish login` for an interactive setup.";

export interface AcquirePublishingTokenOptions {
  envName: string;
  environment: SitecoreApiClientOptions;
}

/**
 * Returns a Bearer JWT for the SAI Publishing API.
 *
 * Resolution order:
 *   1. Cached publishing token in the OS keychain (set either by a
 *      previous `acquirePublishingToken` call or by `scai publish
 *      login`). The token is reused until it expires or the cache
 *      is cleared.
 *   2. Fresh M2M mint via the env's client credentials, requesting
 *      `xmcpub.jobs.t:r/w` + `xmcpub.queue:r` scopes explicitly. The
 *      result is cached for future calls in the same env.
 *
 * Refuses with `AUTH_REQUIRED` when neither path yields a token,
 * surfacing a specific hint about where credentials are looked up.
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
      "No publishing-scoped token cached and the env lacks the client credentials needed to mint one.",
      "AUTH_REQUIRED",
      { hint: NO_CREDENTIALS_HINT }
    );
  }

  try {
    const result = await requestClientCredentialsToken(env, M2M_SCOPE_PARAM);
    if (!result.accessToken) {
      throw createScaiError(
        "Sitecore did not return an access token for the publishing scopes.",
        "AUTH_REQUIRED",
        { hint: NO_CREDENTIALS_HINT }
      );
    }
    await setPublishingToken(options.envName, result.accessToken);
    return result.accessToken;
  } catch (error) {
    if (error instanceof Error && /granted scopes/i.test(error.message)) {
      throw createScaiError(
        "Auth0 issued a token but stripped the publishing scopes — the automation client isn't granted xmcpub.jobs.t:r / :w on this resource server.",
        "AUTH_REQUIRED",
        {
          hint: "Verify with your Sitecore admin that the automation client carries xmcpub.jobs.t:r, xmcpub.jobs.t:w, xmcpub.queue:r grants on `https://api.sitecorecloud.io`. Newly-created deploy automation clients should carry these by default.",
        }
      );
    }
    throw error;
  }
};
