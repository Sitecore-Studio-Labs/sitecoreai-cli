/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/sites`.
 *
 * Sites API client surface. The Sites API is XM Cloud's CRUD proxy for
 * sites, collections, languages, hosts, and related resources at
 * `https://xmapps-api.sitecorecloud.io`. Spec is pinned at
 * `./api/openapi.yaml` and types are regenerated via `pnpm sites:codegen`.
 *
 * The `recipe` entry also re-exports the recipe-required subset of these
 * via `createSitesApiClient` — that pair is the higher-level interface
 * the recipe planner depends on. This entry exposes the per-resource
 * primitives directly for callers that don't need the recipe seam.
 */

export * from "./api";
