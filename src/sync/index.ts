/**
 * The `sync` engine — the kind-agnostic spine that pulls, diffs, and
 * pushes recipes against live Sitecore environments.
 *
 * A recipe kind (brand-kit, component, page, site, brief, campaign)
 * implements {@link RecipeKind}; the engine functions below drive it.
 *
 * See docs/recipe-sync-architecture.md for the recipe / sync model.
 */
export type { ChangeKind, PlanSummary, RecipeChange, RecipePlan } from "./plan";
export { planIsNoop, summarizePlan, writingChanges } from "./plan";

export type { ApplyResult, KindRef, RecipeKind, ResolvedIdentity, SyncContext } from "./kind";

export type {
  Baseline,
  BaselineStorage,
  FieldClassification,
  PullConflictPolicy,
  PushConflictPolicy,
} from "./baseline";
export { classifyHashes, hashJsonValue, stableStringify } from "./baseline";

export { classifyCellHashMaps, resolveCellByPolicy } from "./merge-cells";

export {
  HttpBaselineStorage,
  SYNC_BASELINE_ENV_VARS,
  resolveHttpBaselineStorageFromEnv,
} from "./http-baseline-storage";

export type { PullOptions, PushOptions, PushOutcome, SyncMode } from "./engine";
export { syncDiff, syncPull, syncPush } from "./engine";

export { loadRecipe, writeRecipe } from "./io";

export { eraseKind, getKind, listKinds, registerKind } from "./registry";

// --- Cross-domain aggregate ---------------------------------------------
export {
  aggregatePull,
  aggregateStatus,
  aggregatePush,
  slugifyRecipeId,
  DEFAULT_SYNC_DIR,
} from "./aggregate";
export type {
  AggregatePullItem,
  AggregatePullKind,
  AggregatePullResult,
  AggregateDriftStatus,
  AggregateStatusItem,
  AggregateStatusKind,
  AggregateStatusResult,
  AggregatePushStatus,
  AggregatePushItem,
  AggregatePushKind,
  AggregatePushResult,
} from "./aggregate";
