/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/serialization`.
 *
 * Re-exports the curated Sitecore Management + Authoring GraphQL client
 * surface from `./api`. The `./api` barrel stays the source of truth for
 * which symbols are public; this file exists so the `serialization`
 * subpath follows the same `<area>/index.ts` convention as every other
 * exported area.
 */

export * from "./api";
export * from "./context";
