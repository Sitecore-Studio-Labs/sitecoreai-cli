/**
 * Sites API client — public entry.
 *
 * The Sites API is XM Cloud's CRUD proxy for sites, collections,
 * languages, hosts, and related resources. Base URL:
 * `https://xmapps-api.sitecorecloud.io`. Spec pinned at
 * `./openapi.yaml`; types regenerated via `pnpm sites:codegen`.
 *
 * This entry exposes the recipe-required subset of operations.
 * Additional surface (favourites, editor profiles, aggregation,
 * the full hosts/hierarchy/sitemap surface, the rest of the
 * collections + sites endpoints) gets added as new flows surface
 * a need. See `plans/scai-cli-api-coverage.md` (orchestrator) for
 * the rollout plan.
 */

export * from "./types";
export { sitesRequest } from "./request";

// Sites
export { createSite, retrieveSite, listSites, deleteSite, listSiteTemplates } from "./sites";
export type { Site, SiteTemplate, NewSiteInput, JobResponse } from "./sites";

// Collections
export { listCollections, createCollection, retrieveCollection } from "./collections";
export type { SiteCollection, CreateSiteCollectionInput } from "./collections";

// Languages
export { listLanguages, addLanguage } from "./languages";
export type { Language, AddLanguageModel } from "./languages";

// Jobs
export { getJobStatus, listJobs } from "./jobs";
export type { Job } from "./jobs";
