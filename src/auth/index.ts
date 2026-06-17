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
 * This barrel is the canonical cross-domain seam AND the home of the
 * implementation: every domain area outside `serialization` imports
 * these primitives from `@/auth`, and a boundary test keeps it that way.
 *
 *     import { requestClientCredentialsToken } from "@/auth";
 *
 * The OAuth/token implementation lives next door in
 * `./client-credentials` and the shared option shape in `./types`. The
 * old `serialization/api/auth.ts` and `serialization/api/types.ts` are
 * now thin published-API forwarders that re-export from here, so SDK
 * consumers of `@sitecoreai-labs/sitecoreai-cli/serialization` keep
 * resolving the same symbols. There is one internal home (`@/auth`) and
 * one published alias (`./serialization`) — no third path.
 *
 * What lives here:
 *   - {@link requestClientCredentialsToken} — OAuth M2M mint
 *   - {@link getAccessToken} — env-profile-keyed mint+cache loop
 *   - the password + device-authorization flows
 *   - {@link DEFAULT_SITECORE_API_AUDIENCE} — `api.sitecorecloud.io`
 *   - the shared {@link SitecoreApiClientOptions} shape (`./types`)
 *   - JWT decode helpers (re-exported from {@link "@/shared/jwt"})
 *   - the per-domain {@link createApiAuth} factory
 */

export {
  acquireAccessToken,
  DEFAULT_SITECORE_API_AUDIENCE,
  getAccessToken,
  pollDeviceToken,
  requestClientCredentialsToken,
  requestDeviceAuthorization,
  requestPasswordToken,
  type AccessTokenResult,
  type DeviceAuthorizationResult,
} from "./client-credentials";

export type { SitecoreApiClientOptions } from "./types";

export { decodeJwtPayload, extractScopes } from "@/shared/jwt";

export { createApiAuth, isTokenFresh, type ApiAuthSpec, type ResolvedCredential } from "./factory";
