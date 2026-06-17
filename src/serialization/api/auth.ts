/**
 * Published-API forwarder.
 *
 * The OAuth / token implementation (client-credentials, password, and
 * device-authorization flows, plus the keychain-aware `getAccessToken`
 * wrapper) now lives in `@/auth/client-credentials` — the cross-domain
 * auth seam. This module re-exports it so SDK consumers of
 * `@sitecoreai-labs/sitecoreai-cli/serialization` (which re-exports these
 * symbols through `serialization/api/index.ts`) and any intra-area
 * `./auth` imports keep resolving to the same implementation.
 */
export {
  acquireAccessToken,
  getAccessToken,
  requestClientCredentialsToken,
  requestPasswordToken,
  requestDeviceAuthorization,
  pollDeviceToken,
  DEFAULT_SITECORE_API_AUDIENCE,
  type AccessTokenResult,
  type DeviceAuthorizationResult,
} from "@/auth/client-credentials";
