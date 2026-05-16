/**
 * Shape types for the SAI Publishing REST API.
 *
 * Spec: https://api-docs.sitecore.com/sai/publishing-api
 * OpenAPI YAML (raw, fetchable): https://api-docs.sitecore.com/_bundle/sai/publishing-api/index.yaml
 *
 * Host: `https://edge-platform.sitecorecloud.io`
 * Path prefix on the wire: `/authoring/publishing/v1/jobs`
 *   (Internal route also responds at `/api/publishing/v1/jobs` —
 *   both paths reach the same handler.)
 *
 * Auth: Bearer JWT minted via env-level automation client; scopes
 * `xmcpub.jobs.t:r/w` + `xmcpub.queue:r` (`.t` = tenant tier; `.a`
 * admin variants are for Pages-UI user tokens only).
 */

/**
 * Lifecycle states from the `system.status` field on PublishJobResponse.
 * Note `Canceled` (US) and `Canceling` (US) — the API uses US spelling
 * in this enum. Internally we normalize "Canceled" → "cancelled" so
 * the rest of the codebase carries one consistent vocabulary, but we
 * preserve the wire form here so callers reading raw responses see
 * what the API actually sent.
 */
export type PublishJobStatusWire =
  | "Queued"
  | "Running"
  | "Completed"
  | "Failed"
  | "Canceled"
  | "Canceling";

export type PublishJobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "cancelling";

/** A single item in the Tier 1 (`publish item`) request body. */
export interface PublishItemModel {
  /** Item GUID. Required, 1–50 chars. */
  id: string;
  /** Item type / kind — see `ItemModel.type` in the OpenAPI spec.
   *  Required, 1–256 chars. scai sends "item" by default; the exact
   *  enum / accepted values are spec-documented as a free string. */
  type: string;
  /** Language code (e.g. "en-US"). Optional, 0–20 chars. */
  locale?: string;
}

/**
 * Mode for whole-environment publish (Tier 2). Empirically verified
 * 2026-05-14 via `publish all --mode Smart` against the agents env:
 * one job considered ~76K items across every site in the env (4
 * locales), with `statistics.itemsSkipped` reflecting the full
 * publishable corpus — the publish target is the environment's Edge
 * endpoint, not a single Sitecore site. The API field is named
 * `xmc.site` for legacy XM reasons (one-instance = one-site = one-DB)
 * and has NO site-identifier field by design.
 *
 * Concurrency (verified 2026-05-14): the API accepts overlapping
 * whole-env submissions but processes them serially. A second
 * `publish all` queued while one is running waited ~80s behind the
 * first; both completed, neither was rejected or coalesced. Submission
 * itself is non-blocking (POST returns immediately with Queued).
 *
 * Stats shape (verified 2026-05-14): `statistics.itemsSent` /
 * `itemsProcessed` / `xmc.itemsDeleted` / `xmc.itemsSkipped` are
 * scalar aggregates summed across all locales. The response has NO
 * `locales: [{...}]` per-locale breakdown — for per-locale visibility
 * an operator must submit separate per-locale jobs and compare totals.
 */
export type PublishSiteMode = "Republish" | "Incremental" | "Smart";

/** Mode for item / subtree publish (Tier 1). */
export type PublishItemsMode = "Republish" | "Smart";

export interface PublishSiteOptions {
  mode: PublishSiteMode;
}

export interface PublishItemsOptions {
  mode: PublishItemsMode;
  /** Publish items referenced by the targeted items (matches the
   *  legacy dotnet `--related` flag). Default false. */
  publishRelatedItems?: boolean;
  /** Publish descendants of the targeted items (matches `--subitems`).
   *  Default false. */
  publishChildren?: boolean;
}

export interface XmcPublishingOptions {
  /** Languages to publish. When omitted, defaults to the env's
   *  configured publish languages. */
  locales?: string[];
  /** Whole-environment publish (Tier 2). The OpenAPI field is named
   *  `site` for historical reasons but operates tenant-wide — see
   *  `PublishSiteMode` docstring. Mutually exclusive with `items`. */
  site?: PublishSiteOptions;
  /** Set for Tier 1 (`publish item`). */
  items?: PublishItemsOptions;
}

export interface PublishOptionsModel {
  /** Explicit per-item list (Tier 1). Optional in the spec; in
   *  practice scai sets `items` for Tier 1 and `xmc.site` for
   *  Tier 2, never both. */
  items?: PublishItemModel[];
  /** XM Cloud-specific publish controls — mode, locales, etc. */
  xmc?: XmcPublishingOptions;
}

/** Body for `POST /authoring/publishing/v1/jobs`. */
export interface CreatePublishJobRequest {
  name: string;
  source: string;
  description?: string;
  options: PublishOptionsModel;
}

export interface PublishJobUserRef {
  id?: string | null;
  name?: string | null;
}

export interface PublishJobSystem {
  organizationId?: string | null;
  tenantId: string;
  tenantJobId?: string | null;
  status: PublishJobStatusWire;
  queuedTime?: string | null;
  startTime?: string | null;
  finishTime?: string | null;
  createdBy: PublishJobUserRef;
  canceledBy?: PublishJobUserRef | null;
}

export interface PublishJobPermissions {
  canViewDetails: boolean;
  canCancel: boolean;
}

export interface PublishJobResponse {
  id: string;
  name?: string | null;
  description?: string | null;
  source?: string | null;
  options: PublishOptionsModel;
  statistics?: Record<string, unknown> | null;
  system: PublishJobSystem;
  permissions: PublishJobPermissions;
}

/**
 * Normalized job shape consumed by scai's CLI / library callers.
 * Smaller surface than the raw API response — the rest is kept on
 * the `raw` field for callers that need it.
 */
export interface PublishJob {
  id: string;
  state: PublishJobState;
  name?: string;
  source?: string;
  /** Number of items processed so far — when statistics expose it. */
  processedCount?: number;
  /** Number of items total — when statistics expose it. */
  totalCount?: number;
  startedAt?: string;
  completedAt?: string;
  /** Whether the API permits cancelling this job. */
  canCancel: boolean;
  /** Full raw response, for callers that need fields not in this
   *  normalized shape. */
  raw: PublishJobResponse;
}

export interface PublishingApiClientOptions {
  /** Bearer JWT with the publishing-scope grants. */
  accessToken: string;
  /** Base host override. Default `https://edge-platform.sitecorecloud.io`. */
  baseUrl?: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
}

export interface ListPublishJobsQuery {
  pageNumber?: number;
  pageSize?: number;
  /** Filter to jobs in these states (using wire form). */
  statuses?: PublishJobStatusWire[];
  /** Free-form source filter; matches the `source` query param. */
  source?: string[];
}
