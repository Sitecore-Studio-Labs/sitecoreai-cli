/**
 * Cross-domain Sitecore Authoring API primitives.
 *
 * The Authoring GraphQL transport (`runAuthoringGraphQL`), the typed
 * client wrapper (`createAuthoringClient`), and the site-discovery
 * helper (`discoverSites`) all started in `recipe/api/` because Recipe
 * was the first heavy consumer. Every other domain that hits
 * Authoring — deploy, publishing, content, hygiene, workflow, webhooks,
 * brief recipe — now imports the same primitives from there, making
 * `recipe/api` a de facto shared module.
 *
 * This barrel is the canonical cross-domain seam. Implementation
 * files still live under `recipe/api/` (move-without-rewire left as
 * a follow-up); cross-area callers should import from here:
 *
 *     import { runAuthoringGraphQL } from "@/authoring";
 *     import { createAuthoringClient } from "@/authoring";
 *     import { discoverSites } from "@/authoring";
 *
 * Direct imports through `@/recipe/api/...` remain valid for the
 * Recipe domain itself.
 */

export { runAuthoringGraphQL, type AuthoringRequestOptions } from "@/recipe/api/graphql";

export { createAuthoringClient } from "@/recipe/api/authoring-client";

export type { AuthoringApiClient } from "@/recipe/api/client";

export { discoverSites } from "@/recipe/api/site-discovery";
