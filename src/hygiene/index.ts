/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/hygiene`.
 *
 * Hygiene = the audit + cleanup surface (`scai hygiene audit *`, `scai hygiene cleanup *`).
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
export { runAuditBrokenLinks } from "./tasks/audit/broken-links";
export type { AuditBrokenLinksOptions, BrokenLinkReport } from "./tasks/audit/broken-links";
export { runAuditUnusedMedia } from "./tasks/audit/unused-media";
export type { AuditUnusedMediaOptions, UnusedMediaReport } from "./tasks/audit/unused-media";
export { runAuditOrphans } from "./tasks/audit/orphans";
export type { AuditOrphansOptions, OrphanReport } from "./tasks/audit/orphans";
export { runAuditStaleWorkflow } from "./tasks/audit/stale-workflow";
export type { AuditStaleWorkflowOptions, StaleWorkflowReport } from "./tasks/audit/stale-workflow";
export { runAuditLanguageData } from "./tasks/audit/language-data";
export type { AuditLanguageDataOptions, LanguageDataReport } from "./tasks/audit/language-data";
export { runAuditDeadTemplates } from "./tasks/audit/dead-templates";
export type { AuditDeadTemplatesOptions, DeadTemplateReport } from "./tasks/audit/dead-templates";
export { runAuditDatasourceMissing } from "./tasks/audit/datasource-missing";
export type {
  AuditDatasourceMissingOptions,
  DatasourceMissingReport,
} from "./tasks/audit/datasource-missing";
export { runAuditDuplicates } from "./tasks/audit/duplicates";
export type { AuditDuplicatesOptions, DuplicatesGroup } from "./tasks/audit/duplicates";
export { runAuditEmptyItems } from "./tasks/audit/empty-items";
export type { AuditEmptyItemsOptions, EmptyItemReport } from "./tasks/audit/empty-items";
export { runAuditPageDesignOrphans } from "./tasks/audit/page-design-orphans";
export type {
  AuditPageDesignOrphansOptions,
  PageDesignOrphanReport,
} from "./tasks/audit/page-design-orphans";
export { runAuditPersonalizationBroken } from "./tasks/audit/personalization-broken";
export type {
  AuditPersonalizationBrokenOptions,
  PersonalizationBrokenReport,
} from "./tasks/audit/personalization-broken";
export { runCleanupVersionsPrune } from "./tasks/cleanup/versions-prune";
export type {
  CleanupVersionsPruneOptions,
  VersionPruneAction,
} from "./tasks/cleanup/versions-prune";
export { runCleanupArchivePurge } from "./tasks/cleanup/archive-purge";
export type { CleanupArchivePurgeOptions, ArchivePurgeAction } from "./tasks/cleanup/archive-purge";
export { runCleanupDeadTemplates } from "./tasks/cleanup/dead-templates";
export type {
  CleanupDeadTemplatesOptions,
  DeadTemplatePurgeAction,
  FolderCleanupAction,
} from "./tasks/cleanup/dead-templates";
export { runCleanupDuplicates } from "./tasks/cleanup/duplicates";
export type {
  CleanupDuplicatesOptions,
  DuplicatePurgeAction,
  DuplicatesKeepRule,
} from "./tasks/cleanup/duplicates";
export { runCleanupSlugConflicts } from "./tasks/cleanup/slug-conflicts";
export type {
  CleanupSlugConflictsOptions,
  SlugConflictPurgeAction,
  SlugConflictsAction,
  SlugConflictsKeepRule,
} from "./tasks/cleanup/slug-conflicts";
export { runCleanupVersionsArchive } from "./tasks/cleanup/versions-archive";
export type {
  CleanupVersionsArchiveOptions,
  VersionArchiveAction,
} from "./tasks/cleanup/versions-archive";
export { runAuditFindReplace } from "./tasks/audit/find-replace";
export type { AuditFindReplaceOptions, FindReplaceMatch } from "./tasks/audit/find-replace";
export { runAuditStaleContent } from "./tasks/audit/stale-content";
export type { AuditStaleContentOptions, StaleContentReport } from "./tasks/audit/stale-content";
export { runCleanupFindReplace } from "./tasks/cleanup/find-replace";
export type { CleanupFindReplaceOptions, FindReplaceAction } from "./tasks/cleanup/find-replace";
export { runAuditLargeFields } from "./tasks/audit/large-fields";
export type { AuditLargeFieldsOptions, LargeFieldReport } from "./tasks/audit/large-fields";
export { runAuditHeavyTemplates } from "./tasks/audit/heavy-templates";
export type {
  AuditHeavyTemplatesOptions,
  HeavyTemplateReport,
} from "./tasks/audit/heavy-templates";
export { runAuditMissingMeta } from "./tasks/audit/missing-meta";
export type { AuditMissingMetaOptions, MissingMetaReport } from "./tasks/audit/missing-meta";
export { runAuditAltTextMissing } from "./tasks/audit/alt-text-missing";
export type {
  AuditAltTextMissingOptions,
  AltTextMissingReport,
} from "./tasks/audit/alt-text-missing";
export { runAuditRoleBloat } from "./tasks/audit/role-bloat";
export type { AuditRoleBloatOptions, RoleBloatReport } from "./tasks/audit/role-bloat";
export { runAuditEmptyRoles } from "./tasks/audit/empty-roles";
export type { AuditEmptyRolesOptions, EmptyRoleReport } from "./tasks/audit/empty-roles";
export { runAuditStaleUsers } from "./tasks/audit/stale-users";
export type { AuditStaleUsersOptions, StaleUserReport } from "./tasks/audit/stale-users";
export { runAuditBrokenImages } from "./tasks/audit/broken-images";
export type { AuditBrokenImagesOptions, BrokenImageReport } from "./tasks/audit/broken-images";
export { runAuditSlugConflicts } from "./tasks/audit/slug-conflicts";
export type { AuditSlugConflictsOptions, SlugConflictGroup } from "./tasks/audit/slug-conflicts";
export { runAuditTranslationCoverage } from "./tasks/audit/translation-coverage";
export type {
  AuditTranslationCoverageOptions,
  TranslationCoverageReport,
} from "./tasks/audit/translation-coverage";
export { runAuditFallbackDrift } from "./tasks/audit/fallback-drift";
export type { AuditFallbackDriftOptions, FallbackDriftReport } from "./tasks/audit/fallback-drift";
export { runAuditEmptyLinks } from "./tasks/audit/empty-links";
export type { AuditEmptyLinksOptions, EmptyLinkReport } from "./tasks/audit/empty-links";
export { runCleanupFieldSet } from "./tasks/cleanup/field-set";
export type {
  CleanupFieldSetOptions,
  FieldSetAction,
  FieldSetMode,
} from "./tasks/cleanup/field-set";
export { runCleanupRename } from "./tasks/cleanup/rename";
export type { CleanupRenameOptions, RenameAction } from "./tasks/cleanup/rename";
export { runCleanupLanguageVersionAdd } from "./tasks/cleanup/language-version-add";
export type {
  CleanupLanguageVersionAddOptions,
  LanguageVersionAddAction,
} from "./tasks/cleanup/language-version-add";
export { runAuditSiteResidue } from "./tasks/audit/site-residue";
export type {
  AuditSiteResidueOptions,
  SiteResidueKind,
  SiteResidueReport,
} from "./tasks/audit/site-residue";
export { runCleanupSiteResidue } from "./tasks/cleanup/site-residue";
export type {
  CleanupSiteResidueOptions,
  SiteResidueCleanupAction,
  InboundRef,
} from "./tasks/cleanup/site-residue";
export { runCleanupWorkflowAdvance } from "./tasks/cleanup/workflow-advance";
export type {
  CleanupWorkflowAdvanceOptions,
  WorkflowAdvanceAction,
} from "./tasks/cleanup/workflow-advance";
export { runCleanupWorkflowApply } from "./tasks/cleanup/workflow-apply";
export type {
  CleanupWorkflowApplyOptions,
  WorkflowApplyAction,
  WorkflowApplyActionStatus,
} from "./tasks/cleanup/workflow-apply";
export { runCleanupEmptyFolders } from "./tasks/cleanup/empty-folders";
export type { CleanupEmptyFoldersOptions, EmptyFolderAction } from "./tasks/cleanup/empty-folders";
export { runCleanupRoles } from "./tasks/cleanup/roles";
export type { CleanupRolesOptions, RoleCleanupAction } from "./tasks/cleanup/roles";
export { runCleanupUsers } from "./tasks/cleanup/users";
export type { CleanupUsersOptions, UserCleanupAction } from "./tasks/cleanup/users";
export { runAuditSuiteRun } from "./tasks/audit/suite-run";
export type { AuditSuiteRunOptions } from "./tasks/audit/suite-run";
export { runHistoryCapture, runHistoryList, runHistoryDiff } from "./tasks/audit/history";
export type {
  HistoryCaptureOptions,
  HistoryListOptions,
  HistoryDiffOptions,
} from "./tasks/audit/history";
export { runAuditAll, auditNames } from "./tasks/audit/all";
export type { AuditAllOptions } from "./tasks/audit/all";
export {
  runBaselineShow,
  runBaselineCreate,
  runBaselineRemove,
  runBaselineReset,
} from "./tasks/audit/baseline";
export type {
  BaselineShowOptions,
  BaselineCreateOptions,
  BaselineRemoveOptions,
  BaselineResetOptions,
} from "./tasks/audit/baseline";
export type { HygieneCommonOptions } from "./tasks/shared";
