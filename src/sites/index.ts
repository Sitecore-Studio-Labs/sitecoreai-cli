/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/sites`.
 *
 * Sites API client surface. The Sites API is XM Cloud's CRUD proxy for
 * sites, collections, languages, hosts, and related resources at
 * `https://xmapps-api.sitecorecloud.io`. Spec is pinned at
 * `./api/openapi.yaml` and types are regenerated via `pnpm sites:codegen`.
 *
 * The `recipe` entry also re-exports the recipe-required subset of these
 * via `createSitesApiClient` — that pair is the higher-level interface
 * the recipe planner depends on. This entry exposes the per-resource
 * primitives directly for callers that don't need the recipe seam.
 */

export type {
  SitesApiClientOptions,
  SitesRequestInit,
  SitesQueryValue,
  SitesQueryRecord,
} from "./api/types";
export { DEFAULT_SITES_API_BASE } from "./api/types";
export { sitesRequest } from "./api/request";

export {
  createSite,
  retrieveSite,
  listSites,
  updateSite,
  setSiteBrandKit,
  deleteSite,
  listSiteTemplates,
  retrieveWorkflowStatistics,
  type Site,
  type SiteTemplate,
  type NewSiteInput,
  type UpdateSiteInput,
  type JobResponse,
  type WorkflowsStatistics,
  type WorkflowStatistics,
  type WorkflowStateStatistics,
} from "./api/sites";

export {
  listCollections,
  createCollection,
  retrieveCollection,
  type SiteCollection,
  type CreateSiteCollectionInput,
} from "./api/collections";

export { listLanguages, addLanguage, type Language, type AddLanguageModel } from "./api/languages";

export { getJobStatus, listJobs, type Job } from "./api/jobs";
