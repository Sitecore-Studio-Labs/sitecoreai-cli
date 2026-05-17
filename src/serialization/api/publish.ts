import { createScaiError } from "@/shared/errors";
import type { SitecoreApiClientOptions } from "./types";
import { GraphQLRequestOptions, runGraphQL } from "./graphql";
import { createFieldFilterSet } from "../field-filter";
import { fetchItemMetadata } from "./items";

const publishMutation = `
mutation($path: String, $languages: [String] , $itemIds : [String], $republish : Boolean, $target : String) {
  publish(path: $path, languages: $languages, itemIds :$itemIds, republish :$republish, target :$target) {
    id
    processedCount
    stateCode
    stateName
  }
}`;

const publishStatusQuery = `
query($id: String)
{
  publishingStatus(id: $id)
  {
    id
    processedCount
    stateCode
    stateName
  }
}`;

const listTargetsQuery = `
query {
  listOfTargets
}`;

export const publishItems = async (
  environment: SitecoreApiClientOptions,
  itemIds: string[],
  target?: string,
  options?: GraphQLRequestOptions
): Promise<{ id: string; processedCount: number; stateName: string }> => {
  const data = await runGraphQL<{
    publish: { id: string; processedCount: number; stateName: string };
  }>(environment, publishMutation, { itemIds, target }, options);
  return data.publish;
};

export const checkPublishStatus = async (
  environment: SitecoreApiClientOptions,
  publishId: string,
  options?: GraphQLRequestOptions
): Promise<{ id: string; processedCount: number; stateName: string }> => {
  const data = await runGraphQL<{
    publishingStatus: { id: string; processedCount: number; stateName: string };
  }>(environment, publishStatusQuery, { id: publishId }, options);
  return data.publishingStatus;
};

export const fetchPublishingTargets = async (
  environment: SitecoreApiClientOptions,
  options?: GraphQLRequestOptions
): Promise<string[]> => {
  const data = await runGraphQL<{ listOfTargets: string[] }>(
    environment,
    listTargetsQuery,
    undefined,
    options
  );
  return data.listOfTargets ?? [];
};

/** Outcome of {@link publishItemSubtree}. */
export interface PublishItemSubtreeResult {
  /** Source item path that was published. */
  path: string;
  /** Source database the items were read from. */
  database: string;
  /** Publish target, when one was given. */
  target?: string;
  /** Number of items resolved under `path` and submitted to the job. */
  itemCount: number;
  /** The publish job receipt. */
  job: { id: string; processedCount: number; stateName: string };
}

/**
 * Publish an item and all of its descendants in one job.
 *
 * Resolves every item under `path` via the Management API, then submits
 * the whole set to the publish pipeline. Throws (`INPUT_INVALID`) when
 * `path` resolves to no items. Composes `fetchItemMetadata` +
 * `publishItems` so callers (CLI, MCP, embedding SDK) get the workflow
 * rather than wiring the two raw calls themselves.
 */
export const publishItemSubtree = async (
  environment: SitecoreApiClientOptions,
  path: string,
  options: { database?: string; target?: string } = {}
): Promise<PublishItemSubtreeResult> => {
  const database = options.database ?? "master";
  const fieldFilter = createFieldFilterSet([], []);
  const metadata = await fetchItemMetadata(
    environment,
    database,
    path,
    "ItemAndDescendants",
    fieldFilter,
    false
  );
  const itemIds = metadata.map((entry) => entry.id);
  if (itemIds.length === 0) {
    throw createScaiError(
      `No items found under path '${path}' in database '${database}'.`,
      "INPUT_INVALID"
    );
  }
  const job = await publishItems(environment, itemIds, options.target);
  return { path, database, target: options.target, itemCount: itemIds.length, job };
};
