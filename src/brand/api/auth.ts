import {
  DEFAULT_SITECORE_API_AUDIENCE,
  requestClientCredentialsToken,
} from "@/serialization/api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/api/types";
import { createScaiError } from "@/shared/errors";
import { getBrandClientSecret, getBrandToken, setBrandToken } from "@/shared/keychain";
import type { BrandCredential } from "@/config/types";

/**
 * OAuth scopes scai's *currently shipped* Brand operations require.
 *
 * The AI APIs key can carry any of:
 *
 *   - `ai.org.brd:r`  / `ai.org.brd:w`   — Brand Management read/write
 *   - `ai.org.docs:r` / `ai.org.docs:w`  — Documents read/write
 *   - `ai.org.br:gen`                    — Brand Review generate
 *     (NB: the OpenAPI YAML example shows `ai.orgs.br:gen` with a
 *     plural `orgs`; verified empirically 2026-05-14 the real scope
 *     is singular `org`. Docs typo, not a scope-name variant.)
 *   - `ai.org:admin`                     — org-level admin
 *
 * Real-world quirk (verified 2026-05-14): AI APIs keys in Cloud Portal
 * are issued with **per-key scope subsets**, not the full grant set.
 * An operator can paste a credential that has `ai.org.brd:r` only, or
 * one that adds `ai.orgs.br:gen`, etc. If scai *requests* scopes the
 * client wasn't granted, Auth0 returns a 403 outright (not "filtered
 * to intersection"). So the OAuth mint requests **no scope** — Auth0
 * grants whatever the client has — and scai validates the resulting
 * token's scope claim against the *minimum scai needs to run the
 * operations it ships today*.
 *
 * Today that minimum is just `ai.org.br:gen` (Brand Review). Brand
 * Management primitives, when they land, will lift this to include
 * `ai.org.brd:r` (read) and later `ai.org.brd:w` (write). The login
 * flow stays permissive — it persists any minted credential and tells
 * the operator what's missing — but per-operation calls will refuse
 * if their specific scope isn't present.
 */
export const BRAND_REQUIRED_SCOPES = ["ai.org.br:gen"] as const;

const NO_CREDENTIAL_HINT =
  "Run `scai setup login brand --env <env>` to provision the credential, or paste an existing AI APIs key into `brand.<orgId>` in sitecoreai.cli.json (clientId only; secret goes through the keychain via the login flow). Create the credential in Cloud Portal → Stream → Admin → AI APIs keys.";

export interface AcquireBrandTokenOptions {
  orgId: string;
  credential: BrandCredential;
}

const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

export const extractScopes = (token: string): string[] => {
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

export const hasBrandScopes = (token: string): boolean => {
  const granted = new Set(extractScopes(token));
  return BRAND_REQUIRED_SCOPES.every((s) => granted.has(s));
};

const DEFAULT_AUTHORITY = "https://auth.sitecorecloud.io";

/**
 * Returns a Bearer JWT for the Sitecore Brand APIs.
 *
 * Resolution order, cheapest first:
 *
 *   1. Cached Brand token in the keychain (keyed by orgId) — set
 *      by a previous mint via this function. Reused while it still
 *      carries the required scopes; cleared on next 401 by callers.
 *   2. Fresh M2M mint against the `auth.sitecorecloud.io/oauth/token`
 *      endpoint with `audience=https://api.sitecorecloud.io`, using
 *      the org-scoped `clientId` from `brand[orgId]` and the
 *      matching secret from the keychain. Cached on success.
 *
 * Refuses with `AUTH_BRAND_REQUIRED` when none of these paths
 * produces a token carrying the required scopes. The error message
 * decodes the granted-scope set and infers the credential class so
 * operators know whether they need to provision a new AI APIs key or
 * just re-login.
 */
export const acquireBrandToken = async (options: AcquireBrandTokenOptions): Promise<string> => {
  const { orgId, credential } = options;

  // 1. Cached token keyed by orgId. No scope assertion — the real
  //    server-side scope enforcement happens on the API call itself,
  //    and gating here would skip a perfectly usable token whenever
  //    the operation it's used for doesn't need the validated scope.
  const cached = await getBrandToken(orgId);
  if (cached) {
    return cached;
  }

  // 2. Fresh M2M mint via the AI APIs key.
  const clientSecret = await getBrandClientSecret(orgId);
  if (!credential.clientId || !clientSecret) {
    throw createScaiError(
      `No Brand credential is configured for org '${orgId}'.`,
      "AUTH_BRAND_REQUIRED",
      { hint: NO_CREDENTIAL_HINT }
    );
  }

  const authority = credential.authority ?? DEFAULT_AUTHORITY;
  const audience = credential.audience ?? DEFAULT_SITECORE_API_AUDIENCE;

  // Reuse the shared client-credentials helper. It accepts a
  // `SitecoreApiClientOptions`-shaped argument; we only need the
  // auth-relevant fields.
  const mintEnv: SitecoreApiClientOptions = {
    authority,
    clientId: credential.clientId,
    clientSecret,
    audience,
  };

  let result;
  try {
    // Mint with NO scope parameter — Auth0 grants whatever the AI APIs
    // key has been issued, and per-operation scope checks below filter
    // for the subset scai needs. Requesting scopes the key wasn't
    // granted causes Auth0 to 403 outright.
    result = await requestClientCredentialsToken(mintEnv);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw createScaiError(
      `Auth0 refused the Brand scope request for org '${orgId}'.`,
      "AUTH_BRAND_REQUIRED",
      { hint: `Auth0 error: ${detail}. ${NO_CREDENTIAL_HINT}` }
    );
  }
  if (!result.accessToken) {
    throw createScaiError(
      `Sitecore did not return an access token for org '${orgId}'.`,
      "AUTH_BRAND_REQUIRED",
      { hint: NO_CREDENTIAL_HINT }
    );
  }
  // Deliberately do NOT pre-validate scopes here. The Brand API's own
  // server-side scope enforcement is the source of truth; gating
  // here either over-blocks (when the API is more permissive than
  // scai's expected scope list) or under-protects (when scai's list
  // drifts from the API's actual requirement). Let the call go
  // through and surface the real `BRAND_API_FAILED` with the
  // server's `error_description` if the scope is genuinely missing.
  await setBrandToken(orgId, result.accessToken);
  return result.accessToken;
};
