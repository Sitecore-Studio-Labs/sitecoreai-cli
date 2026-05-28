/**
 * JWT decode helpers shared between the per-domain auth modules.
 *
 * scai mints separate tokens for separate credentials (the CM
 * automation client, the AI APIs key for Brand, the Brief/Campaign
 * tokens, etc.) — they don't share an Auth0 application or scope set,
 * so the acquisition paths stay per-domain. What they DO share is
 * the JWT-payload shape returned by Auth0 / Microsoft, so the
 * decode + scope-extraction primitives live here and the per-domain
 * `auth.ts` modules import them.
 */

/**
 * Decode the middle segment of a JWT into its JSON payload. Returns
 * `undefined` on any structural problem (wrong segment count, bad
 * base64url, non-JSON payload) — callers treat that as "no
 * verifiable claims" and either fall through to a server-side check
 * or refuse the token.
 *
 * This is decode-only — it does NOT verify the signature. Callers
 * that need verification must do so against the issuer's JWKS.
 * Token validity in scai is established by the server-side API
 * accepting the token, not by client-side verification.
 */
export const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
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

/**
 * Extract the granted scope list from a JWT. Supports both the
 * Auth0-style `scope` string ("a b c") and the Microsoft-style
 * `scp` array (["a", "b", "c"]). Returns an empty array if the
 * token is unparseable or carries no scope claim.
 */
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

/**
 * Default safety margin: a token whose `exp` falls inside this window
 * is treated as expired so a long-running API call doesn't 401/403
 * mid-flight against a token that was technically valid at request
 * start. 60s matches the publishing auth path's window, which was
 * tuned for publish calls that can hold the connection for tens of
 * seconds.
 */
export const DEFAULT_TOKEN_EXPIRY_MARGIN_S = 60;

/**
 * Returns true when the JWT's `exp` claim is within `marginSeconds`
 * of `now`. Used to fail-closed on cached tokens that are about to
 * expire so callers re-mint instead of handing a stale Bearer to the
 * server.
 *
 * Returns `false` (treat as valid) when the token can't be decoded or
 * has no parseable `exp` claim. The rationale: an undecodable token
 * is a structural problem the caller should surface as the real
 * server-side failure (401/403), not pre-block here on top of it. The
 * publishing and brand cache paths both apply scope checks in
 * addition to this expiry check, so an undecodable token still gets
 * rejected by the scope gate.
 */
export const isTokenExpired = (
  token: string,
  marginSeconds: number = DEFAULT_TOKEN_EXPIRY_MARGIN_S
): boolean => {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return false;
  }
  const exp = typeof payload.exp === "number" ? payload.exp : Number(payload.exp);
  if (!Number.isFinite(exp)) {
    return false;
  }
  const nowS = Math.floor(Date.now() / 1000);
  return exp - nowS <= marginSeconds;
};
