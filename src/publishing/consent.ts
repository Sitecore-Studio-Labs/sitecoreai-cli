import crypto from "node:crypto";
import type { PublishAuditCaller, PublishAuditScope, PublishAuditScopeKind } from "./audit";

/**
 * Consent + scope-token primitives for `scai content publish`.
 *
 * The safety model has three layers (see docs/parity-with-devex.md):
 *
 *   1. CLI default = `--what-if`. Real call requires `--allow-write`.
 *   2. Production-tier envs require a two-step typed scope token
 *      (dry-run → token → real call with token).
 *   3. Library layer requires a structured `PublishConsent` argument;
 *      an agent can't synthesize one without going through CLI prompt,
 *      MCP host approval, or a CI gate.
 *
 * The scope token is the operator-visible artifact that bridges steps
 * 2 and 3. It encodes the resolved scope (envName + tenant + items +
 * languages + target), is bound to a TTL, and is **self-contained** —
 * no server-side cache needed for verification. Threat model: scope
 * tokens prevent fat-finger errors and give operators visibility into
 * what's about to publish; they don't (and can't) defend against a
 * malicious process running as the operator. That defense lives at
 * the MCP `allowWrite` gate and the operator's CI-secret hygiene.
 */

export const SCOPE_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PublishConsent {
  confirmedBy: PublishAuditCaller;
  scope: PublishAuditScope;
  scopeHash: string;
  issuedAt: string;
  ttlMs: number;
}

const canonicalScope = (scope: PublishAuditScope): string =>
  JSON.stringify({
    envName: scope.envName,
    resolvedTenantId: scope.resolvedTenantId ?? "",
    target: scope.target,
    kind: scope.kind,
    // Sort itemIds so deterministic input order doesn't depend on
    // upstream resolver behaviour. Languages sorted likewise.
    itemIds: (scope.itemIds ?? []).slice().sort(),
    path: scope.path ?? "",
    languages: (scope.languages ?? []).slice().sort(),
    includeSubitems: Boolean(scope.includeSubitems),
    includeRelated: Boolean(scope.includeRelated),
    // Include strategy + version in the hash so the scope token binds
    // to the specific shape of the intended mutation. Defaulting to
    // empty string keeps the legacy publish-item / publish-all hash
    // values unchanged (both pass strategy=undefined, version=undefined).
    strategy: scope.strategy ?? "",
    version: scope.version ?? "",
  });

/**
 * Stable hash over the resolved publish scope. Identical scopes
 * produce identical hashes regardless of input ordering, so a dry-run
 * and a subsequent real call with the same arguments resolve to the
 * same hash and the scope token verifies.
 */
export const computeScopeHash = (scope: PublishAuditScope): string =>
  crypto.createHash("sha256").update(canonicalScope(scope)).digest("hex").slice(0, 32);

interface ScopeTokenPayload {
  v: 1;
  /** Scope kind — see `PublishAuditScopeKind` in audit.ts. Existing
   *  publish-item / publish-all tokens encode "item" / "full"; the new
   *  unpublish / content version verbs add their own kinds so a token
   *  minted for one verb can't be replayed against another. */
  k: PublishAuditScopeKind;
  /** envName, kept short. */
  e: string;
  /** scopeHash (32 hex chars). */
  h: string;
  /** issuedAt epoch ms. */
  t: number;
  /** ttl in ms. */
  ttl: number;
}

const encodePayload = (payload: ScopeTokenPayload): string =>
  Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const decodePayload = (encoded: string): ScopeTokenPayload | undefined => {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const obj = JSON.parse(json) as ScopeTokenPayload;
    if (obj.v !== 1) return undefined;
    return obj;
  } catch {
    return undefined;
  }
};

/**
 * Mint a scope token for the resolved scope. Returns a short string
 * the operator copies from dry-run output to the real-call command.
 *
 * Format: `pub_<base64url(payload)>`. The payload is self-describing
 * and self-verifying: TTL + scopeHash mean a token can only validate
 * against an identical scope within its lifetime window.
 */
export const mintScopeToken = (scope: PublishAuditScope, now = Date.now()): string => {
  const payload: ScopeTokenPayload = {
    v: 1,
    k: scope.kind,
    e: scope.envName,
    h: computeScopeHash(scope),
    t: now,
    ttl: SCOPE_TOKEN_TTL_MS,
  };
  return `pub_${encodePayload(payload)}`;
};

export type ScopeTokenVerificationFailure =
  | { ok: false; reason: "malformed" }
  | { ok: false; reason: "expired"; ageMs: number }
  | { ok: false; reason: "env-mismatch"; expectedEnv: string; tokenEnv: string }
  | { ok: false; reason: "kind-mismatch"; expectedKind: string; tokenKind: string }
  | {
      ok: false;
      reason: "scope-mismatch";
      expectedHash: string;
      tokenHash: string;
    };

export type ScopeTokenVerification =
  | { ok: true; payload: ScopeTokenPayload }
  | ScopeTokenVerificationFailure;

/**
 * Verify a scope token against the operator's current request. The
 * token must:
 *   - parse and have v=1
 *   - not be expired (issued within ttl of now)
 *   - name the same env as the request
 *   - name the same kind (item vs full)
 *   - encode a scopeHash that matches the request's recomputed hash
 *
 * Any mismatch is surfaced with a specific `reason` so the CLI can
 * tell the operator exactly what changed between the dry-run and the
 * real call.
 */
export const verifyScopeToken = (
  token: string,
  scope: PublishAuditScope,
  now = Date.now()
): ScopeTokenVerification => {
  if (!token.startsWith("pub_")) {
    return { ok: false, reason: "malformed" };
  }
  const payload = decodePayload(token.slice("pub_".length));
  if (!payload) {
    return { ok: false, reason: "malformed" };
  }
  const ageMs = now - payload.t;
  if (ageMs < 0 || ageMs > payload.ttl) {
    return { ok: false, reason: "expired", ageMs };
  }
  if (payload.e !== scope.envName) {
    return {
      ok: false,
      reason: "env-mismatch",
      expectedEnv: scope.envName,
      tokenEnv: payload.e,
    };
  }
  if (payload.k !== scope.kind) {
    return {
      ok: false,
      reason: "kind-mismatch",
      expectedKind: scope.kind,
      tokenKind: payload.k,
    };
  }
  const expectedHash = computeScopeHash(scope);
  if (payload.h !== expectedHash) {
    return {
      ok: false,
      reason: "scope-mismatch",
      expectedHash,
      tokenHash: payload.h,
    };
  }
  return { ok: true, payload };
};
