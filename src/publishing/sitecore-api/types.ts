/**
 * SAI Publishing API — type shapes for the REST surface documented at
 * https://api-docs.sitecore.com/sai/publishing-api. Backed by host
 * `https://edge-platform.sitecorecloud.io`, path prefix
 * `/authoring/publishing/v1/jobs`. Bearer JWT (automation-client
 * client-credentials), same auth flow as the Sites + Pages APIs.
 *
 * PR 1 covers the read shapes only. Submit / cancel land in later PRs
 * once a real-tenant request body capture pins the POST /jobs schema.
 */

/**
 * Job state vocabulary. The catalog page lists "queued, running,
 * completed, failed, cancelled" but does not pin the exact wire form
 * (string casing, numeric code, etc.). The client normalizes whatever
 * the API returns to this union — keep the rest of the codebase
 * insulated from a future field-name change.
 */
export type PublishJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface PublishJob {
  id: string;
  state: PublishJobState;
  processedCount?: number;
  totalCount?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface PublishingApiClientOptions {
  /**
   * Bearer JWT for the Publishing API. Acquired via
   * `getAccessToken(environment)` in
   * `src/serialization/sitecore-api/auth.ts`. Required — no anonymous
   * access.
   */
  accessToken: string;
  /**
   * Base host override. Defaults to
   * `https://edge-platform.sitecorecloud.io`. Tests point this at a
   * fixture server; ops typically don't override it.
   */
  baseUrl?: string;
  /**
   * Optional client-side fetch timeout in ms. When undefined, only
   * the server-side timeout applies.
   */
  timeoutMs?: number;
}
