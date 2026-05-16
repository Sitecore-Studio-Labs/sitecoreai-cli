import { sitesRequest } from "./request";
import type { components } from "./schema";
import type { SitesApiClientOptions } from "./types";

/**
 * Sites resource group — the recipe-required subset.
 *
 * Async creation note: `createSite` returns a `JobResponse` (a job
 * handle), not the created site. The Sites API runs site creation
 * as an async background job; callers poll the job via `getJobStatus`
 * (in `./jobs.ts`) until completion before reading the new site.
 * This is a Sites API characteristic — neither the recipe push nor
 * any callers should assume the site is ready the moment `createSite`
 * resolves.
 */

export type Site = components["schemas"]["Site"];
export type SiteTemplate = components["schemas"]["SiteTemplate"];
export type NewSiteInput = components["schemas"]["NewSiteInput"];
export type UpdateSiteInput = components["schemas"]["UpdateSiteInput"];
/**
 * Codegen-typed JobResponse, extended for the runtime shape. The
 * OpenAPI spec defines only `handle`, but some Sites API deployments
 * return `jobHandle` instead. Callers must accept either.
 */
export type JobResponse = components["schemas"]["JobResponse"] & {
  /** Runtime-only alias for `handle` returned by some deployments. */
  jobHandle?: string | null;
};

/**
 * Create a new site from a site template (async).
 *
 * Returns a `JobResponse` carrying a job handle; the actual site
 * creation runs server-side. Poll via `getJobStatus` until the job
 * completes, then look up the site by name via `listSites`.
 *
 * Pass either `collectionId` (existing collection) or
 * `collectionName` (creates a new collection alongside the site).
 */
export const createSite = (
  options: SitesApiClientOptions,
  input: NewSiteInput
): Promise<JobResponse> =>
  sitesRequest<JobResponse>(options, "/api/v1/sites", {
    method: "POST",
    body: input,
  });

/** Retrieve a single site by ID. */
export const retrieveSite = (options: SitesApiClientOptions, siteId: string): Promise<Site> =>
  sitesRequest<Site>(options, `/api/v1/sites/${encodeURIComponent(siteId)}`);

/**
 * Update mutable properties of a site (`PATCH /api/v1/sites/{siteId}`).
 *
 * Synchronous — returns the updated `Site`, not a job handle. Only the
 * fields present on `patch` are changed; omit the rest. To rename a
 * site use the dedicated Rename operation instead.
 *
 * The optional `environmentId` query scopes the write to a specific
 * Content Services environment (server default: "main").
 *
 * `patch` is `Partial<UpdateSiteInput>` — the codegen marks
 * `displayName`/`description` as required (spec artifact: they carry a
 * junk `default`), but PATCH is partial by definition, so callers send
 * only the fields they intend to change.
 */
export const updateSite = (
  options: SitesApiClientOptions,
  siteId: string,
  patch: Partial<UpdateSiteInput>,
  query?: { environmentId?: string }
): Promise<Site> =>
  sitesRequest<Site>(options, `/api/v1/sites/${encodeURIComponent(siteId)}`, {
    method: "PATCH",
    body: patch,
    ...(query?.environmentId ? { query: { environmentId: query.environmentId } } : {}),
  });

/**
 * Associate (or clear) the brand kit linked to a site.
 *
 * Thin convenience over `updateSite` for the single most common
 * brand-kit operation: pass a kit UUID to link, or `null` to detach.
 * `brandKitId` is the id of an AI Skills brand kit (see the brand
 * area — `brand_inspect verb='list-kits'`).
 */
export const setSiteBrandKit = (
  options: SitesApiClientOptions,
  siteId: string,
  brandKitId: string | null,
  query?: { environmentId?: string }
): Promise<Site> => updateSite(options, siteId, { brandKitId }, query);

/** List all sites in the environment. */
export const listSites = (options: SitesApiClientOptions): Promise<Site[]> =>
  sitesRequest<Site[]>(options, "/api/v1/sites");

/**
 * Delete a site permanently — removes pages, settings, media,
 * datasources, presentation elements, dictionaries, components,
 * variants, and page designs. Async; returns a job handle.
 */
export const deleteSite = (options: SitesApiClientOptions, siteId: string): Promise<JobResponse> =>
  sitesRequest<JobResponse>(options, `/api/v1/sites/${encodeURIComponent(siteId)}`, {
    method: "DELETE",
  });

/**
 * List site templates available for site creation. Use this to look
 * up the `templateId` that `createSite` requires when the caller
 * only knows the template's display name.
 */
export const listSiteTemplates = (options: SitesApiClientOptions): Promise<SiteTemplate[]> =>
  sitesRequest<SiteTemplate[]>(options, "/api/v1/sites/templates");

export type WorkflowsStatistics = components["schemas"]["WorkflowsStatistics"];
export type WorkflowStatistics = components["schemas"]["WorkflowStatistics"];
export type WorkflowStateStatistics = components["schemas"]["WorkflowStateStatistics"];

/**
 * Fetch the per-site workflow rollup: workflows defined on the site,
 * their states, and the count of pages in each state. Backs
 * `scai content workflow status --site <siteId>`.
 *
 * Optional `environmentId` query param ("main" by default server-side)
 * scopes to a specific Content Services environment.
 */
export const retrieveWorkflowStatistics = (
  options: SitesApiClientOptions,
  siteId: string,
  query?: { environmentId?: string }
): Promise<WorkflowsStatistics> =>
  sitesRequest<WorkflowsStatistics>(
    options,
    `/api/v1/sites/${encodeURIComponent(siteId)}/statistics/workflow`,
    query?.environmentId ? { query: { environmentId: query.environmentId } } : undefined
  );
