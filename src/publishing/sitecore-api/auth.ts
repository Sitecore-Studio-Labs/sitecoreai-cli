import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/sitecore-api/types";
import { createScaiError } from "@/shared/errors";
import { getPublishingToken } from "@/shared/keychain";

/**
 * OAuth scopes the SAI Publishing API requires.
 *
 * Discovered 2026-05-14 by decoding a Pages-UI user token:
 *   - `xmcpub.jobs.a:r` — read publishing jobs (GET /jobs, /jobs/{id})
 *   - `xmcpub.jobs.a:w` — create or cancel publishing jobs
 *     (POST /jobs, POST /jobs/{jobId}/cancel)
 *   - `xmcpub.queue:r`  — read the publish queue (GET /jobs/filters,
 *     /jobs/summary, etc.)
 *
 * The standard scai deploy token (granted to client
 * `Chi8EwfFnEejksk3Sed9hlalGiM9B2v7` without an explicit `scope`)
 * carries `xmclouddeploy.*` + `xmcloud.cm:admin` and returns 403 from
 * the Publishing API. A separate `scai publish login` flow acquires a
 * token specifically scoped for publishing, stored under a publishing-
 * specific keychain key. See [src/publishing/tasks/login.ts].
 */
export const PUBLISHING_SCOPES_REQUESTED = [
  "xmcpub.jobs.a:r",
  "xmcpub.jobs.a:w",
  "xmcpub.queue:r",
] as const;

const M2M_SCOPE_PARAM = PUBLISHING_SCOPES_REQUESTED.join(" ");

const SCOPE_NOT_LOGGED_IN_HINT =
  "Run 'scai publish login -n <env>' to acquire a publishing-scoped token (interactive browser flow). The deploy token from 'scai login' does not carry publishing scopes.";

export interface AcquirePublishingTokenOptions {
  envName: string;
  environment: SitecoreApiClientOptions;
}

/**
 * Returns a Bearer JWT for the SAI Publishing API.
 *
 * Resolution order:
 *   1. Publishing-specific keychain entry (populated by
 *      `scai publish login`). This is the canonical path on
 *      interactive operator machines.
 *   2. M2M client-credentials with publishing scopes — for CI runners
 *      whose env profile carries explicit clientId/clientSecret with
 *      publishing scopes configured in Auth0.
 *
 * Refuses with `AUTH_REQUIRED` if neither path yields a token.
 */
export const acquirePublishingToken = async (
  options: AcquirePublishingTokenOptions
): Promise<string> => {
  const cached = await getPublishingToken(options.envName);
  if (cached) {
    return cached;
  }

  // M2M fallback — only attempted when the env profile actually has the
  // credentials. Most operator setups won't; CI runners that have
  // publishing-authorized M2M clients can.
  const env = options.environment;
  if (env.clientId && env.clientSecret && env.authority) {
    try {
      const result = await requestClientCredentialsToken(env, M2M_SCOPE_PARAM);
      if (result.accessToken) {
        return result.accessToken;
      }
    } catch (error) {
      // Fall through to the user-facing error; preserve detail in `cause`.
      throw createScaiError(
        "Could not acquire a publishing-scoped token via client credentials.",
        "AUTH_REQUIRED",
        {
          hint: `${SCOPE_NOT_LOGGED_IN_HINT} For CI use, verify the automation client is authorized in Auth0 for xmcpub.* scopes. Underlying error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      );
    }
  }

  throw createScaiError(
    "No publishing-scoped token available for this environment.",
    "AUTH_REQUIRED",
    { hint: SCOPE_NOT_LOGGED_IN_HINT }
  );
};
