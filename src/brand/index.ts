/**
 * Public library surface for the Sitecore AI Skills Brand APIs
 * (Brand Management + Brand Review).
 *
 * Exported as `@sitecoreai-labs/cli/brand`. Library callers (SDK
 * consumers, MCP server, tests) construct a `BrandApiClientOptions`
 * with their org's credential and call the per-operation primitives
 * directly. The CLI commands and MCP tools sit on top of these
 * primitives — see [[scai-direct-graphql-own-mcp]] for the
 * "primitives over compositions" principle this module follows.
 */

export {
  AI_SKILLS_REQUIRED_SCOPES,
  acquireAiSkillsToken,
  extractScopes,
  hasAiSkillsScopes,
  type AcquireAiSkillsTokenOptions,
} from "./api/auth";

export {
  requestBrandApi,
  type BrandApiClientOptions,
  type BrandApiRequest,
} from "./api/client";

export {
  AI_SKILLS_API_HOST,
  BRAND_MANAGEMENT_BASE_PATH,
  BRAND_REVIEW_BASE_PATH,
  type BrandKitSectionName,
  type BrandReviewInput,
  type BrandReviewResult,
  type BrandReviewScore,
  type BrandReviewSectionResult,
  type BrandReviewSelector,
} from "./api/types";

export { generateBrandReview, type GenerateBrandReviewOptions } from "./review/generate";
