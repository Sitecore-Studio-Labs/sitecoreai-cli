import {
  DEFAULT_SITECORE_API_AUDIENCE,
  requestClientCredentialsToken,
} from "@/serialization/api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/api/types";
import { createScaiError, type ScaiErrorCode } from "@/shared/errors";
import { extractScopes as extractScopesShared } from "@/shared/jwt";

/**
 * Shared client-credentials auth factory.
 *
 * Every scai domain area that talks to an OAuth-protected Sitecore API
 * (brief, campaigns, brand, publishing, …) reinvented the same auth
 * loop: decode the cached JWT's `exp`, mint a token via
 * `requestClientCredentialsToken`, validate granted scopes, cache the
 * result in a domain-specific keychain slot. ~80% of `brief/auth.ts`
 * and `campaigns/auth.ts` is structural duplication; brand and
 * publishing follow the same shape with their own diagnostics.
 *
 * `createApiAuth` collapses that loop into a single seam. Each caller
 * supplies the bits that differ:
 *
 *   - `keychainKey` — the slot identifier (org id, env name, …)
 *   - `getCachedToken` / `setCachedToken` — the keychain
 *      family-specific token cache; one slot per credential class
 *      (brief / campaign / brand / publishing each have their own).
 *   - `resolveCredential` — pulls `{ clientId, clientSecret, authority,
 *      audience }` from wherever this credential class lives (env
 *      profile + three-tier client-credential chain, or a registered
 *      brand AI APIs key, …). Returning `undefined` is the
 *      "no-credential" signal — the factory turns it into the
 *      caller-specified missing-credential error.
 *   - `scopes` — the M2M `scope` parameter to send to the IdP. Pass
 *      `undefined` (or omit) to mint without an explicit scope (the
 *      brand path does this because Auth0 issues the AI APIs key's
 *      per-key grant unfiltered).
 *   - `requiredScopes` — optional post-mint validation. If the minted
 *      token doesn't carry every scope listed here, `onMissingScopes`
 *      is called to build a diagnostic error.
 *   - `errorCode` — the `ScaiErrorCode` to throw on every failure
 *      branch (publishing uses `AUTH_REQUIRED`, brand/campaign use
 *      `AUTH_BRAND_REQUIRED`).
 *   - `onMissingCredential` / `onMintFailure` / `onNoAccessToken` /
 *     `onMissingScopes` — small message-builder callbacks so each
 *     caller can keep its current error messages and remediation
 *     hints verbatim.
 *
 * Lives in a thin `src/auth/` domain area, not `src/shared/`, because
 * the shared layer is a hard leaf — it must not import any other
 * domain area, and the factory needs `requestClientCredentialsToken`
 * from `@/serialization/api/auth`.
 */

/**
 * JWT exp claim (seconds since epoch). Returns `undefined` when the
 * token isn't a decodable JWT — the caller should treat that as
 * "expired" so the next mint runs.
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

/**
 * Whether a cached JWT is still safe to use. The default 60 s skew
 * absorbs clock drift + in-flight request latency: a token within
 * that window is treated as already expired so the call mints fresh
 * rather than racing the clock and 401-ing mid-flight.
 */
export const isTokenFresh = (jwt: string, skewSeconds = 60): boolean => {
  const exp = decodeExp(jwt);
  if (exp === undefined) return false;
  return exp > Math.floor(Date.now() / 1000) + skewSeconds;
};

/** A resolved credential ready to be exchanged for an access token. */
export interface ResolvedCredential {
  clientId: string;
  clientSecret: string;
  /** Authority defaults to `https://auth.sitecorecloud.io`. */
  authority?: string;
  /** Audience defaults to `https://api.sitecorecloud.io`. */
  audience?: string;
}

/** Specification of one API's auth seam. See module-level JSDoc. */
export interface ApiAuthSpec {
  /** Slot identifier passed to the keychain helpers (org id, env, …). */
  keychainKey: string;
  /** Reads the cached token from this credential class's keychain slot. */
  getCachedToken: (key: string) => Promise<string | undefined>;
  /** Writes a freshly-minted token to this credential class's keychain slot. */
  setCachedToken: (key: string, token: string) => Promise<unknown>;
  /**
   * Resolves a usable `{ clientId, clientSecret, ... }` pair. Returning
   * `undefined` triggers the `onMissingCredential` error path.
   */
  resolveCredential: () => Promise<ResolvedCredential | undefined>;
  /**
   * M2M `scope` parameter, joined by spaces. Pass `undefined` to mint
   * without an explicit scope (Auth0 issues the client's per-key grant).
   */
  scopes?: string;
  /** Post-mint scope assertion. Omit to skip granted-scope validation. */
  requiredScopes?: readonly string[];
  /** Code thrown for every failure branch. */
  errorCode: ScaiErrorCode;
  /** Message + hint when `resolveCredential()` returned `undefined`. */
  onMissingCredential: () => { message: string; hint?: string };
  /** Message + hint when `requestClientCredentialsToken` rejected. */
  onMintFailure: (error: unknown) => { message: string; hint?: string };
  /** Message + hint when the mint succeeded but the IdP returned no token. */
  onNoAccessToken: () => { message: string; hint?: string };
  /**
   * Message + hint when the minted token is missing one or more entries
   * from `requiredScopes`. Receives the granted scope list (extracted
   * from the JWT) so callers can render rich diagnostics — the
   * publishing path infers credential class (org-level vs env-level)
   * from the granted scopes here.
   */
  onMissingScopes?: (
    token: string,
    granted: readonly string[]
  ) => {
    message: string;
    hint?: string;
  };
}

/**
 * Re-exported from `@/shared/jwt` so callers that already pull
 * factory primitives don't have to reach across to `shared/` for
 * the scope decoder. Implementation lives in shared/jwt.ts.
 */
export const extractScopes = extractScopesShared;

/**
 * Builds the per-domain token acquirer. Returns an async function that
 * implements the standard cache → resolve → mint → validate → cache
 * loop with the spec's per-caller knobs filled in.
 */
export const createApiAuth = (spec: ApiAuthSpec): (() => Promise<string>) => {
  return async (): Promise<string> => {
    const cached = await spec.getCachedToken(spec.keychainKey);
    if (cached && isTokenFresh(cached)) {
      return cached;
    }

    const credential = await spec.resolveCredential();
    if (!credential) {
      const { message, hint } = spec.onMissingCredential();
      throw createScaiError(message, spec.errorCode, hint ? { hint } : undefined);
    }

    const mintEnv: SitecoreApiClientOptions = {
      authority: credential.authority ?? "https://auth.sitecorecloud.io",
      clientId: credential.clientId,
      clientSecret: credential.clientSecret,
      audience: credential.audience ?? DEFAULT_SITECORE_API_AUDIENCE,
    };

    let result;
    try {
      result = spec.scopes
        ? await requestClientCredentialsToken(mintEnv, spec.scopes)
        : await requestClientCredentialsToken(mintEnv);
    } catch (error) {
      const { message, hint } = spec.onMintFailure(error);
      throw createScaiError(message, spec.errorCode, hint ? { hint } : undefined);
    }

    if (!result.accessToken) {
      const { message, hint } = spec.onNoAccessToken();
      throw createScaiError(message, spec.errorCode, hint ? { hint } : undefined);
    }

    if (spec.requiredScopes && spec.requiredScopes.length > 0) {
      const granted = extractScopes(result.accessToken);
      const grantedSet = new Set(granted);
      const missing = spec.requiredScopes.filter((s) => !grantedSet.has(s));
      if (missing.length > 0) {
        const handler =
          spec.onMissingScopes ??
          ((_token: string, grant: readonly string[]): { message: string; hint?: string } => ({
            message: `Token is missing required scopes: ${missing.join(", ")}. Granted: ${
              grant.length > 0 ? grant.join(", ") : "(none)"
            }.`,
          }));
        const { message, hint } = handler(result.accessToken, granted);
        throw createScaiError(message, spec.errorCode, hint ? { hint } : undefined);
      }
    }

    await spec.setCachedToken(spec.keychainKey, result.accessToken);
    return result.accessToken;
  };
};
