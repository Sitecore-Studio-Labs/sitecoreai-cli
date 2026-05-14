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

export { requestBrandApi, type BrandApiClientOptions, type BrandApiRequest } from "./api/client";

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

export { runAiSkillsLogin, type AiSkillsLoginOptions } from "./tasks/login";

export {
  runBrandReview,
  resolveReviewInputs,
  detectInputFormat,
  computeExitCode,
  type BrandReviewCommandOptions,
  type BrandReviewRunResult,
  type BrandReviewFormat,
} from "./tasks/review";

export {
  scoreToSarifLevel,
  summarizeOutcomes,
  type ReviewOutcome,
  type OutcomeSummary,
} from "./review/outcomes";

export { buildJsonReport, type BrandReviewJsonReport } from "./review/format-json";
export { buildSarifReport, type SarifReport } from "./review/format-sarif";
export { buildTextReport, formatTextRow, formatTextSummary } from "./review/format-text";

export {
  uploadDocument,
  DOCUMENTS_BASE_PATH,
  type UploadDocumentOptions,
  type UploadedDocument,
  type DocumentCreateMetadata,
  type DocumentUploadReference,
} from "./documents/upload";

export {
  runBrandIngestionPipeline,
  runEnrichSectionsPipeline,
  PIPELINE_BASE_PATH,
  type RunBrandIngestionOptions,
  type RunEnrichSectionsOptions,
} from "./pipeline/run";
