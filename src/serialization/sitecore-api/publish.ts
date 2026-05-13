import type { SitecoreApiClientOptions } from "./types";
import { GraphQLRequestOptions, runGraphQL } from "./graphql";

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
