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

export type { ApplyResult, KindRef, RecipeKind, SyncContext } from "./kind";

export type { PushOptions, PushOutcome, SyncMode } from "./engine";
export { syncDiff, syncPull, syncPush } from "./engine";

export { loadRecipe, writeRecipe } from "./io";

export { getKind, listKinds, registerKind } from "./registry";
