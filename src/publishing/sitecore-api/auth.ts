import { requestClientCredentialsToken } from "@/serialization/sitecore-api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/sitecore-api/types";
import { createScaiError } from "@/shared/errors";

/**
 * OAuth scopes the SAI Publishing API requires.
 *
 * Discovered 2026-05-14 by decoding a Pages-UI user token; these are
 * the standard Sitecore Auth0 scopes for the publishing surface:
 *   - `xmcpub.jobs.a:r` — read publishing jobs (GET /jobs, /jobs/{id})
 *   - `xmcpub.jobs.a:w` — create or cancel publishing jobs
 *     (POST /jobs, POST /jobs/{jobId}/cancel)
 *   - `xmcpub.queue:r`  — read the publish queue (GET /jobs/filters,
 *     /jobs/summary, etc.)
 *
 * scai's default `getAccessToken()` returns a token requested without
 * a `scope` parameter, so the automation client's *default* scope set
 * (typically `xmclouddeploy.*` + `xmcloud.cm:admin`) is what it
 * carries — and that grant set returns 403 from the Publishing API.
 * This helper requests a token specifically scoped for publishing.
 *
 * If the M2M client isn't configured in Auth0 to grant these scopes,
 * the OAuth response will fail (or return a token that the Publishing
 * API still rejects with 403). PR 2's design treats user-flow OIDC as
 * the primary auth path; this M2M helper is a CI / fallback option
 * for cases where the automation client *is* configured to publish.
 */
const PUBLISHING_SCOPES = "xmcpub.jobs.a:r xmcpub.jobs.a:w xmcpub.queue:r";

export const acquirePublishingToken = async (
  environment: SitecoreApiClientOptions
): Promise<string> => {
  const result = await requestClientCredentialsToken(environment, PUBLISHING_SCOPES);
  if (!result.accessToken) {
    throw createScaiError(
      "Sitecore did not return an access token for the publishing scopes.",
      "AUTH_REQUIRED",
      {
        hint: "Verify the automation client is configured to grant 'xmcpub.jobs.a:r' and 'xmcpub.jobs.a:w' scopes in the Sitecore Cloud Portal.",
      }
    );
  }
  return result.accessToken;
};
