/**
 * Production `SitecoreApiClient` factory for the Sitecore Authoring +
 * Management GraphQL surface.
 *
 * Unlike `createAuthoringClient` in `recipe/` (which adds path
 * resolution, parent-folder auto-creation, and read-retry behavior on
 * top of the wire calls), this factory is a thin **options-binding**
 * wrapper around the existing function-style API:
 *
 *   const sc = createSitecoreApiClient({ host, accessToken });
 *   await sc.fetchItemMetadata("master", "/sitecore/content/Home");
 *
 * It exists so the deploy + serialization surfaces match the recipe
 * surface's seam shape (`create*Client(options) -> typed methods`).
 * If you don't want the seam, the underlying functions remain exported
 * from `serialization` and you can call them options-first directly.
 */
import { fetchHistoryEntries, fetchHistoryTimestamp } from "./history";
import { executeSerializationCommands, fetchItemData, fetchItemMetadata } from "./items";
import { checkPublishStatus, fetchPublishingTargets, publishItems } from "./publish";
import { fetchRoles, pushRoleCommands } from "./roles";
import type { SitecoreApiClientOptions } from "./types";
import { fetchUsers, pushUserCommands } from "./users";

type Tail<F> = F extends (head: SitecoreApiClientOptions, ...rest: infer R) => infer X
  ? (...args: R) => X
  : never;

export interface SitecoreApiClient {
  readonly options: SitecoreApiClientOptions;
  fetchItemMetadata: Tail<typeof fetchItemMetadata>;
  fetchItemData: Tail<typeof fetchItemData>;
  executeSerializationCommands: Tail<typeof executeSerializationCommands>;
  fetchHistoryTimestamp: Tail<typeof fetchHistoryTimestamp>;
  fetchHistoryEntries: Tail<typeof fetchHistoryEntries>;
  fetchRoles: Tail<typeof fetchRoles>;
  pushRoleCommands: Tail<typeof pushRoleCommands>;
  fetchUsers: Tail<typeof fetchUsers>;
  pushUserCommands: Tail<typeof pushUserCommands>;
  publishItems: Tail<typeof publishItems>;
  checkPublishStatus: Tail<typeof checkPublishStatus>;
  fetchPublishingTargets: Tail<typeof fetchPublishingTargets>;
}

export const createSitecoreApiClient = (options: SitecoreApiClientOptions): SitecoreApiClient => ({
  options,
  fetchItemMetadata: (database, path, ...rest) =>
    fetchItemMetadata(options, database, path, ...rest),
  fetchItemData: (database, path, ...rest) => fetchItemData(options, database, path, ...rest),
  executeSerializationCommands: (commands, ...rest) =>
    executeSerializationCommands(options, commands, ...rest),
  fetchHistoryTimestamp: (...rest) => fetchHistoryTimestamp(options, ...rest),
  fetchHistoryEntries: (timestamp, ...rest) => fetchHistoryEntries(options, timestamp, ...rest),
  fetchRoles: (predicates, ...rest) => fetchRoles(options, predicates, ...rest),
  pushRoleCommands: (commands, ...rest) => pushRoleCommands(options, commands, ...rest),
  fetchUsers: (predicates, ...rest) => fetchUsers(options, predicates, ...rest),
  pushUserCommands: (commands, ...rest) => pushUserCommands(options, commands, ...rest),
  publishItems: (itemIds, ...rest) => publishItems(options, itemIds, ...rest),
  checkPublishStatus: (publishId, ...rest) => checkPublishStatus(options, publishId, ...rest),
  fetchPublishingTargets: (...rest) => fetchPublishingTargets(options, ...rest),
});
