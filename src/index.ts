/**
 * Public SDK barrel for `@sitecoreai-labs/sitecoreai-cli`.
 *
 * **The package's `main` entry.** Importing the package root from a
 * library consumer:
 *
 *   import { recipe, deploy, serialization } from "@sitecoreai-labs/sitecoreai-cli";
 *
 * gives namespace access to every public surface. Symbol-level imports
 * via subpaths are preferred and shorter:
 *
 *   import { compileRecipe } from "@sitecoreai-labs/sitecoreai-cli/recipe";
 *   import { createDeployApiClient } from "@sitecoreai-labs/sitecoreai-cli/deploy";
 *
 * Both paths resolve to the same exports.
 *
 * The CLI binary (`scai` / `sitecoreai-cli`) is published separately under
 * the package's `bin` field — `require("@sitecoreai-labs/sitecoreai-cli")`
 * is safe for SDK consumers and will NOT execute the CLI.
 *
 * Stability: each subpath (recipe, deploy, serialization, brand, sites,
 * publishing, hygiene, webhooks, workflow) has its own stability contract
 * (see the JSDoc at the top of each `index.ts`). Internal modules
 * reachable only through `@/...` path aliases are not part of the public
 * SDK surface and may change between scai versions without notice.
 */

export * as recipe from "./recipe";
export * as deploy from "./deploy/api";
export * as serialization from "./serialization/sitecore-api";
export * as brand from "./brand";
export * as sites from "./sites";
export * as publishing from "./publishing";
export * as hygiene from "./hygiene";
export * as webhooks from "./webhooks";
export * as workflow from "./workflow";

// Errors are re-exported at the top level because every subpath throws
// `ScaiError` — consumers typically do one `instanceof ScaiError` check
// at the boundary regardless of which subpath produced the error.
export * from "./shared/errors";
