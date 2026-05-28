import type { SitecoreApiClientOptions } from "@/auth";
import { createApiAuth } from "@/auth/factory";
import { resolveClientCredential } from "@/shared/client-credential";
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

const MISSING_CREDENTIAL_HINT =
  "Provide an automation client for the org — run `scai setup env <name>` (env-scoped) or `scai setup client create --org` (org-scoped) to mint one (its secret is stored in the OS keychain), or bring your own by setting SITECOREAI_ENV_<ENV>_CLIENT_ID and SITECOREAI_ENV_<ENV>_CLIENT_SECRET. The Brief API does not support interactive operator login.";

export interface AcquireBriefTokenOptions {
  /**
   * Sitecore organization id — the Brief API is org-scoped, so the
   * minted token is cached under `brief:<orgId>` in the OS keychain.
   */
  orgId: string;
  /**
   * Credential-bearing options used to mint the token: the matched env
   * profile's client metadata (when one exists — `name`, `clientId`,
   * `automationClient`, `authority`) plus `organizationId` / `orgClientId`,
   * so the three-tier credential chain can resolve a usable client.
   */
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
 *
 * The cache → resolve → mint → cache loop is implemented by the shared
 * `createApiAuth` factory in `@/auth/factory`; brief plugs in its own
 * keychain slot, scope-request string, error hints, and credential
 * resolver (the three-tier chain, gated on `env.authority` so a
 * profile with no authority falls into the missing-credential branch).
 */
export const acquireBriefToken = async (options: AcquireBriefTokenOptions): Promise<string> => {
  const env = options.environment;
  const acquire = createApiAuth({
    keychainKey: options.orgId,
    getCachedToken: getBriefToken,
    setCachedToken: setBriefToken,
    scopes: M2M_SCOPE_PARAM,
    errorCode: "AUTH_REQUIRED",
    resolveCredential: async () => {
      // `env.authority` is required to mint — fall into the missing-credential
      // branch when absent (matches pre-factory behaviour).
      if (!env.authority) return undefined;
      const credential = await resolveClientCredential({
        envName: env.name,
        clientId: env.clientId,
        automationClientId: env.automationClient?.clientId,
        organizationId: env.organizationId,
        orgClientId: env.orgClientId,
      });
      if (!credential) return undefined;
      return {
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
        authority: env.authority,
        audience: env.audience,
      };
    },
    onMissingCredential: () => ({
      message: `No brief-scoped token available for organization '${options.orgId}'.`,
      hint: MISSING_CREDENTIAL_HINT,
    }),
    onMintFailure: (error) => ({
      message: "Could not acquire a brief-scoped token via client credentials.",
      hint: `${SCOPE_DENIED_HINT} Underlying error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
    onNoAccessToken: () => ({
      message: `No brief-scoped token available for organization '${options.orgId}'.`,
      hint: MISSING_CREDENTIAL_HINT,
    }),
  });
  return acquire();
};
