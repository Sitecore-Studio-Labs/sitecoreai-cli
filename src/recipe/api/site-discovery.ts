/**
 * Published-API forwarder.
 *
 * SXA site discovery now lives in `@/authoring/site-discovery` (the
 * cross-domain seam). This module re-exports it so recipe-internal
 * imports keep resolving to the same implementation.
 */
export {
  discoverSites,
  type DiscoveredSite,
  type DiscoverSitesOptions,
} from "@/authoring/site-discovery";
