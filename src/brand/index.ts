/**
 * Public library surface for the Sitecore Brand APIs
 * (Brand Management + Brand Review).
 *
 * Exported as `@sitecoreai-labs/sitecoreai-cli/unstable/brand`. Library
 * callers (SDK consumers, MCP server, tests) construct a
 * `BrandApiClientOptions` with their org's credential and call the
 * per-operation primitives directly. The CLI commands and MCP tools sit
 * on top of these primitives — see [[scai-direct-graphql-own-mcp]] for
 * the "primitives over compositions" principle this module follows.
 *
 * **Status**: UNSTABLE. The Brand APIs are reverse-engineered from
 * observed traffic; this surface ships under `./unstable/brand` and
 * carries no SemVer stability promise. Schemas, types, and behavior may
 * change in any release without a major bump or a changeset.
 */

export {
  BRAND_REQUIRED_SCOPES,
  acquireBrandToken,
  hasBrandScopes,
  type AcquireBrandTokenOptions,
} from "./api/auth";

export { extractScopes } from "@/shared/jwt";

export { requestBrandApi, type BrandApiClientOptions, type BrandApiRequest } from "./api/client";

export {
  BRAND_API_HOST,
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

export { runBrandLogin, type BrandLoginOptions } from "./tasks/login";

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
  LOCAL_UPLOAD_UNSUPPORTED_MESSAGE,
  LOCAL_UPLOAD_UNSUPPORTED_HINT,
  type UploadDocumentOptions,
  type UploadDocumentSource,
  type UploadedDocument,
  type DocumentUploadReference,
} from "./documents/upload";

export {
  runBrandIngestionPipeline,
  runEnrichSectionsPipeline,
  PIPELINE_BASE_PATH,
  type RunBrandIngestionOptions,
  type RunEnrichSectionsOptions,
} from "./pipeline/run";

export {
  listBrandKits,
  getBrandKit,
  type BrandKitSummary,
  type ListBrandKitsResponse,
  type ListBrandKitsOptions,
  type GetBrandKitOptions,
} from "./kits/list";

export {
  listBrandKitSections,
  listBrandKitFields,
  updateBrandKitField,
  type BrandKitSectionSummary,
  type BrandKitFieldSummary,
  type BrandKitFieldType,
  type BrandKitFieldValue,
  type BrandKitArrayEntry,
  type BrandKitRichArrayEntry,
  type ListBrandKitSectionsOptions,
  type ListBrandKitFieldsOptions,
  type UpdateBrandKitFieldOptions,
} from "./kits/sections";

export {
  createBrandKit,
  publishBrandKit,
  deleteBrandKit,
  type CreateBrandKitOptions,
  type PublishBrandKitOptions,
  type DeleteBrandKitOptions,
} from "./kits/create";

export {
  listDocuments,
  getDocument,
  deleteDocument,
  type DocumentSummary,
  type ListDocumentsResponse,
  type ListDocumentsOptions,
  type GetDocumentOptions,
  type DeleteDocumentOptions,
} from "./documents/list";

export {
  seedBrandKit,
  enrichBrandKitWithDocuments,
  type SeedBrandKitOptions,
  type SeedBrandKitResult,
  type SeedProgressEvent,
  type SeedStage,
  type EnrichExistingKitOptions,
  type EnrichExistingKitResult,
} from "./seed";
