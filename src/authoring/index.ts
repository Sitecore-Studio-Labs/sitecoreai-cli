/**
 * Cross-domain Sitecore Authoring API primitives.
 *
 * The Authoring GraphQL transport (`runAuthoringGraphQL`) and the
 * site-discovery helper (`discoverSites`) all started in `recipe/api/`
 * because Recipe was the first heavy consumer. Every other domain that
 * hits Authoring — deploy, publishing, content, hygiene, workflow,
 * webhooks, brief recipe — now imports them, so they are genuine
 * cross-domain infrastructure and now LIVE here, in `./graphql` and
 * `./site-discovery`. The old `recipe/api/graphql.ts` and
 * `recipe/api/site-discovery.ts` are thin forwarders that re-export from
 * here, keeping the published `@sitecoreai-labs/sitecoreai-cli/recipe`
 * surface and recipe-internal imports resolving.
 *
 *     import { runAuthoringGraphQL } from "@/authoring";
 *     import { discoverSites } from "@/authoring";
 *     import { createAuthoringClient } from "@/authoring";
 *
 * The typed client (`createAuthoringClient` + the `AuthoringApiClient`
 * interface) is a different case: it is a ~1100-line, recipe-coupled
 * GraphQL client (it speaks in recipe's `RemoteItem` shapes), so it
 * stays OWNED by `recipe/api/`. This barrel re-exports it for the few
 * other domains that reuse it — the seam owns the infrastructure
 * (transport, discovery); the domain owns its typed client.
 */

export { runAuthoringGraphQL, type AuthoringRequestOptions } from "./graphql";

export { discoverSites, type DiscoveredSite, type DiscoverSitesOptions } from "./site-discovery";

// Typed client stays recipe-owned (see header) — re-exported here for
// the cross-domain callers (content, deploy, serialization) that reuse it.
export { createAuthoringClient } from "@/recipe/api/authoring-client";

export type { AuthoringApiClient } from "@/recipe/api/client";
