/**
 * Unstable SDK surface, published as the `sites` namespace of the
 * consolidated `@sitecoreai-labs/sitecoreai-cli/unstable` barrel
 * (was `./unstable/sites` before 0.4.2).
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
 *
 * **Status**: UNSTABLE. Ships under `./unstable/sites` and carries no
 * SemVer stability promise — the per-resource primitives may change in
 * any release. The recipe planner's pinned subset (reached via
 * `createSitesApiClient` on the stable `./recipe` entry) is unaffected.
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

export {
  listLanguages,
  listSupportedLanguages,
  addLanguage,
  updateLanguage,
  removeLanguage,
  parseLanguageCode,
  fallbackLanguageIsoFor,
  type Language,
  type AddLanguageModel,
  type SupportedLanguage,
  type EditLanguageInput,
} from "./api/languages";

export { getJobStatus, listJobs, type Job } from "./api/jobs";
