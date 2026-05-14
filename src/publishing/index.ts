/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/publishing`.
 *
 * The Sitecore AI Publishing API (XM Cloud publish jobs) plus the
 * library-layer safety primitives that gate every destructive call:
 * the `PublishConsent` argument, the typed scope-token flow, and the
 * append-only audit log. See `docs/parity-with-devex.md` for the
 * three-layer safety model.
 *
 * Library consumers that wrap publishing for an MCP host, CI pipeline,
 * or higher-level agent are expected to construct a `PublishConsent`
 * before calling the HTTP primitives — the CLI's `runPublishItem` task
 * shows the canonical assembly.
 */

// --- HTTP client primitives --------------------------------------------
export {
  submitPublishJob,
  getPublishJob,
  cancelPublishJob,
  listPublishJobs,
} from "./sitecore-api/client";

export type {
  CreatePublishJobRequest,
  ListPublishJobsQuery,
  PublishItemModel,
  PublishItemsMode,
  PublishItemsOptions,
  PublishJob,
  PublishJobPermissions,
  PublishJobResponse,
  PublishJobState,
  PublishJobStatusWire,
  PublishJobSystem,
  PublishJobUserRef,
  PublishOptionsModel,
  PublishSiteMode,
  PublishSiteOptions,
  PublishingApiClientOptions,
  XmcPublishingOptions,
} from "./sitecore-api/types";

// --- Auth --------------------------------------------------------------
export {
  PUBLISHING_SCOPES_REQUESTED,
  acquirePublishingToken,
  type AcquirePublishingTokenOptions,
} from "./sitecore-api/auth";

// --- Consent + scope tokens --------------------------------------------
export {
  SCOPE_TOKEN_TTL_MS,
  computeScopeHash,
  mintScopeToken,
  verifyScopeToken,
  type PublishConsent,
  type ScopeTokenVerification,
  type ScopeTokenVerificationFailure,
} from "./consent";

// --- Audit log ----------------------------------------------------------
export {
  recordPublishAudit,
  readRecentPublishAudit,
  type PublishAuditCaller,
  type PublishAuditEntry,
  type PublishAuditScope,
} from "./audit";

// --- Environment-tier heuristic ----------------------------------------
export { isProductionTier } from "./env-tier";

// --- Task runners -------------------------------------------------------
export { runPublishStatus, type RunPublishStatusOptions } from "./tasks/status";
export { runPublishItem, type RunPublishItemOptions } from "./tasks/item";
export { runPublishAll, type RunPublishAllOptions } from "./tasks/all";
export { runPublishCancel, type RunPublishCancelOptions } from "./tasks/cancel";
export { runPublishUnpublish, type RunPublishUnpublishOptions } from "./tasks/unpublish";
