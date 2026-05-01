import { sitesRequest } from "./request";
import type { components } from "./schema";
import type { SitesApiClientOptions } from "./types";

/**
 * Collections resource group — recipe-required subset.
 *
 * Sites live inside collections. The recipe push pipeline either
 * creates a new collection alongside the site (via `createSite`'s
 * `collectionName` field) or looks up an existing collection here
 * and passes the ID through `createSite`'s `collectionId` field.
 */

export type SiteCollection = components["schemas"]["SiteCollection"];
export type CreateSiteCollectionInput = components["schemas"]["CreateSiteCollectionInput"];
export type JobResponse = components["schemas"]["JobResponse"];

/** List all site collections. */
export const listCollections = (options: SitesApiClientOptions): Promise<SiteCollection[]> =>
  sitesRequest<SiteCollection[]>(options, "/api/v1/collections");

/**
 * Create a new site collection. Async — returns a job handle. Use
 * this when the recipe needs a collection that doesn't exist yet
 * AND doesn't want to bundle creation into a `createSite` call
 * (e.g. multiple sites sharing a new collection).
 */
export const createCollection = (
  options: SitesApiClientOptions,
  input: CreateSiteCollectionInput
): Promise<JobResponse> =>
  sitesRequest<JobResponse>(options, "/api/v1/collections", {
    method: "POST",
    body: input,
  });

/** Retrieve a single collection by ID. */
export const retrieveCollection = (
  options: SitesApiClientOptions,
  collectionId: string
): Promise<SiteCollection> =>
  sitesRequest<SiteCollection>(options, `/api/v1/collections/${encodeURIComponent(collectionId)}`);
