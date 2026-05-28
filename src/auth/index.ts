/**
 * Cross-domain authentication primitives.
 *
 * scai started life with the OAuth client-credentials helper sitting
 * inside `serialization/api/auth.ts` because Content Serialization was
 * the first surface to need it. Every domain area that has since
 * shipped (publishing, brand, brief, campaigns, content, agents,
 * hygiene) now imports the same primitives from there, which made
 * `serialization/api/auth` a de facto shared module — confusing to
 * find for someone not already familiar with scai's history.
 *
 * This barrel is the canonical cross-domain seam. The implementation
 * still lives in `serialization/api/auth.ts` (move-without-rewire
 * left as a follow-up); cross-area callers should import from here:
 *
 *     import { requestClientCredentialsToken } from "@/auth";
 *
 * The `serialization/api/auth` path stays valid for direct
 * `serialization` SDK consumers — both ways resolve to the same
 * exports.
 *
 * What lives here:
 *   - {@link requestClientCredentialsToken} — OAuth M2M mint
 *   - {@link getAccessToken} — env-profile-keyed mint+cache loop
 *   - {@link DEFAULT_SITECORE_API_AUDIENCE} — `api.sitecorecloud.io`
 *   - The shared {@link SitecoreApiClientOptions} shape
 *   - JWT decode helpers (re-exported from {@link "@/shared/jwt"})
 *   - The per-domain {@link createApiAuth} factory (already here)
 */

export {
  DEFAULT_SITECORE_API_AUDIENCE,
  getAccessToken,
  requestClientCredentialsToken,
} from "@/serialization/api/auth";

export type { SitecoreApiClientOptions } from "@/serialization/api/types";

export { decodeJwtPayload, extractScopes } from "@/shared/jwt";

export { createApiAuth, isTokenFresh, type ApiAuthSpec, type ResolvedCredential } from "./factory";
