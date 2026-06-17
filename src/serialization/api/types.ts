/**
 * Published-API forwarder.
 *
 * `SitecoreApiClientOptions` — the shared Sitecore Management + Authoring
 * GraphQL client option shape — now lives in `@/auth/types` (the
 * cross-domain auth seam). This module re-exports it so SDK consumers of
 * `@sitecoreai-labs/sitecoreai-cli/serialization` (which re-exports it
 * through `serialization/api/index.ts`) keep resolving the same type.
 */
export type { SitecoreApiClientOptions } from "@/auth/types";
