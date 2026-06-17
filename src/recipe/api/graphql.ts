/**
 * Published-API forwarder.
 *
 * The Authoring GraphQL transport now lives in `@/authoring/graphql`
 * (the cross-domain seam). This module re-exports it so the published
 * `@sitecoreai-labs/sitecoreai-cli/recipe` surface (via `recipe/index.ts`)
 * and recipe-internal `./graphql` imports keep resolving to the same
 * implementation.
 */
export { runAuthoringGraphQL, type AuthoringRequestOptions } from "@/authoring/graphql";
