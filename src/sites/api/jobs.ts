import { sitesRequest } from "./request";
import type { components } from "./schema";
import type { SitesApiClientOptions } from "./types";

/**
 * Jobs resource group — recipe-required subset.
 *
 * Async Sites operations (`createSite`, `deleteSite`, `createCollection`,
 * etc.) return a `JobResponse` carrying a `handle` rather than the
 * created/affected resource. Callers poll `getJobStatus(handle)`
 * until completion before reading the resulting state.
 *
 * The Sites API documents two job-related endpoints; we expose both:
 * `/api/v1/jobs` (list all) and `/api/v1/jobs/{jobHandle}/status`
 * (retrieve one). Recipe push only uses `getJobStatus` with a known
 * handle, but `listJobs` is included for the broader CLI surface.
 */

/**
 * Codegen-typed Job, extended for the runtime shape. Some Sites API
 * deployments return a top-level `state` string ("Done", "Succeeded",
 * "Errored") in addition to the OpenAPI-spec'd `status` enum
 * ("Queued"/"Running"/"Completed"/"Failed"). Callers that poll job
 * status need to read both.
 */
export type Job = components["schemas"]["Job"] & {
  /** Runtime-only state string returned by some Sites API deployments. */
  state?: string;
};

/** Retrieve the status of a single job by its handle. */
export const getJobStatus = (options: SitesApiClientOptions, jobHandle: string): Promise<Job> =>
  sitesRequest<Job>(options, `/api/v1/jobs/${encodeURIComponent(jobHandle)}/status`);

/** List all jobs in the environment. */
export const listJobs = (options: SitesApiClientOptions): Promise<Job[]> =>
  sitesRequest<Job[]>(options, "/api/v1/jobs");
