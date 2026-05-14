/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/hygiene`.
 *
 * Hygiene = the audit + cleanup surface (`scai audit *`, `scai cleanup *`).
 * Replaces the dotnet `Sitecore.DevEx dbcleanup` family with a typed,
 * agent-friendly equivalent. See [[scai-content-hygiene-area]] for the
 * design decisions.
 *
 * Three layers exposed here:
 *
 *   1. **API client** — `createHygieneApiClient` + the search/item/role/
 *      user typed surface it wraps. Build your own task runner on top
 *      of this if the bundled runners don't fit.
 *   2. **Task runners** — the same runners the CLI commands call. One
 *      per audit/cleanup, plus the suite/baseline/history wrappers.
 *   3. **Output + baseline helpers** — JSON/CSV/Markdown formatting,
 *      baseline diffing, history snapshots, field-cache.
 */

// --- API client + transport --------------------------------------------
export {
  createHygieneApiClient,
  type HygieneApiClient,
  type HygieneClientOptions,
  type ItemWorkflowState,
  type ArchiveVersionInput,
  type ArchivedItem,
  type ChildSummary,
  type DeleteItemInput,
  type DeleteItemVersionInput,
  type ItemField,
  type ItemTemplateSummary,
  type ItemVersion,
  type RoleSummary,
  type SearchCriterion,
  type SearchCriteriaType,
  type SearchOperator,
  type SearchPage,
  type SearchPaging,
  type SearchQuery,
  type SearchResultItem,
  type SearchStatement,
  type UserDetail,
  type UserSummary,
  MEDIA_LIBRARY_ROOT,
  DEFAULT_MASTER_INDEX,
} from "./api/client";

export {
  runHygieneAuthoringGraphQL,
  type AuthoringRequestOptions as HygieneAuthoringRequestOptions,
} from "./api/graphql";

// --- Output adapters ---------------------------------------------------
export {
  formatAuditOutput,
  writeAuditOutput,
  inferFormatFromExtension,
  type AuditEnvelope,
  type OutputFormat,
} from "./output-adapters";

// --- Baseline ----------------------------------------------------------
export {
  fingerprintFinding,
  openBaseline,
  splitByBaseline,
  type BaselineEntry,
  type BaselineFile,
  type BaselineHandle,
  type OpenBaselineOptions,
} from "./baseline";

// --- History snapshots -------------------------------------------------
export {
  captureHistory,
  listHistory,
  loadSnapshot,
  diffSnapshots,
  type CaptureAuditAllEnvelope,
  type DiffSummary,
  type HistorySnapshot,
  type SnapshotEntry,
} from "./history";

// --- Audit suite -------------------------------------------------------
export {
  loadAuditSuite,
  expandOutputPath,
  auditSuiteToRunnerInput,
  type AuditSuiteEntry,
  type AuditSuiteFile,
} from "./audit-suite";

// --- Field cache -------------------------------------------------------
export {
  createFieldCache,
  wrapFieldsBatchWithCache,
  isAuditCacheEnabled,
  type FieldCache,
  type FieldCacheOptions,
} from "./cache";

// --- Task runners (audits, cleanups, suite, baseline, history) --------
export * from "./tasks";
