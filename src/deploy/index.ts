/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/deploy`.
 *
 * Re-exports the curated Deploy API surface from `./api`. The `./api`
 * barrel stays the source of truth for which symbols are public; this
 * file exists so the `deploy` subpath follows the same `<area>/index.ts`
 * convention as every other exported area.
 */

export * from "./api";
export * from "./context";
