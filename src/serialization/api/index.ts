/**
 * Curated public Sitecore Management + Authoring GraphQL client surface —
 * re-exported by `../index.ts`
 * (`@sitecoreai-labs/sitecoreai-cli/serialization`).
 *
 * Source of truth for what's part of the public Sitecore Management +
 * Authoring GraphQL client surface. Every symbol below is intentional.
 *
 * Internal scai callers should keep importing from sibling files
 * (`./auth`, `./graphql`, etc.) for unstable helpers; this index file
 * is the only path that's contract-stable.
 */

// --- Client configuration ------------------------------------------------

export type { SitecoreApiClientOptions } from "./types";

// --- Curated client seam ------------------------------------------------
//
// `createSitecoreApiClient(options)` returns a typed, options-bound
// facade over the function-style item / history / roles / users /
// publish surface — parallels `createDeployApiClient` and
// `createSitesApiClient`. The underlying functions remain exported
// below for direct use.

export { createSitecoreApiClient, type SitecoreApiClient } from "./client";

// --- Transport seam ------------------------------------------------------

export { runGraphQL, type GraphQLRequestOptions } from "./graphql";

// --- Auth ----------------------------------------------------------------

// `acquireAccessToken` is the pure OAuth flow (no keychain) added in
// Phase A; library consumers that bring their own token cache should
// use it. `getAccessToken` is the CLI-shaped keychain-aware wrapper.
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
} from "./auth";

// --- Item operations -----------------------------------------------------

export { fetchItemMetadata, fetchItemData, executeSerializationCommands } from "./items";

// --- History (poll for remote changes) ----------------------------------

export { fetchHistoryTimestamp, fetchHistoryEntries } from "./history";

// --- Roles ---------------------------------------------------------------

export { fetchRoles, pushRoleCommands } from "./roles";

// --- Users ---------------------------------------------------------------

export { fetchUsers, pushUserCommands } from "./users";

// --- Publishing ---------------------------------------------------------

export {
  publishItems,
  checkPublishStatus,
  fetchPublishingTargets,
  publishItemSubtree,
  type PublishItemSubtreeResult,
} from "./publish";

// --- Data types and domain objects ---------------------------------------
//
// These live one folder up (under `src/serialization/`) because they
// describe the SCS / item data shapes — used by both the API client
// here AND the CLI's local filesystem store. From the library consumer's
// perspective the distinction doesn't matter; they're part of the
// serialization API.

export type {
  ItemData,
  ItemMetadata,
  ItemLanguage,
  ItemVersion,
  ItemFieldValue,
  FieldFilter,
  RoleData,
  UserData,
  HistoryEntry,
  RolePredicateItem,
  UserPredicateItem,
} from "../types";

export { ItemPath } from "../item-path";
