/**
 * The `sync` engine — kind-agnostic pull / diff / push over any
 * `RecipeKind`. The engine owns the write-consent gate, so individual
 * kinds never decide whether they are allowed to write.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { createScaiError } from "@/shared/errors";
import type { BaselineStorage, PullConflictPolicy, PushConflictPolicy } from "./baseline";
import type { ApplyResult, KindRef, RecipeKind, SyncContext } from "./kind";
import { type RecipePlan, planIsNoop } from "./plan";

/** `what-if` prints the plan and writes nothing; `apply` converges. */
export type SyncMode = "what-if" | "apply";

export interface PushOptions {
  mode: SyncMode;
  /**
   * Include `delete` changes. Off by default — `push` is additive, so a
   * recipe omitting an element does not remove it from the remote.
   */
  prune?: boolean;
  /**
   * How to resolve three-way merge conflicts (tenant disagrees with
   * both baseline and recipe). The kind must opt in by consulting
   * `ctx.baselineStorage` during `plan()`; kinds without baseline
   * support ignore this. Default behaviour when omitted is the kind's
   * choice — content recipes default to `"error"`; brief / campaign
   * kinds default to `"cms-wins"` (Sitecore AI is the source-of-truth
   * for author edits).
   */
  conflictPolicy?: PushConflictPolicy;
  /**
   * Backing store for per-recipe baselines. When set, the engine
   * forwards it through `ctx.baselineStorage` so the kind's `plan()`
   * can read the last-applied state for three-way classification, and
   * the kind's `apply()` can write a fresh baseline after a successful
   * write. Omitting it leaves the kind in two-way diff mode (every
   * tenant divergence reads as `recipe-change`).
   */
  baselineStorage?: BaselineStorage;
}

export interface PullOptions {
  /**
   * Conflict policy when the recipe-on-disk (or in-DB, in the
   * orchestrator case) disagrees with both the tenant and the
   * baseline. Mirrors `PushOptions.conflictPolicy` but with `tenant-wins`
   * in place of `cms-wins` since pull writes into the recipe side.
   * Pure-read pulls (no recipe to merge against) ignore this.
   */
  conflictPolicy?: PullConflictPolicy;
  /** See `PushOptions.baselineStorage`. */
  baselineStorage?: BaselineStorage;
}

export interface PushOutcome {
  /** The plan that was computed (deletes filtered out unless `prune`). */
  plan: RecipePlan;
  /** The apply result — `null` under `what-if` or for a no-op plan. */
  result: ApplyResult | null;
}

/**
 * Enrich the caller-supplied context with engine-level overrides
 * (baseline storage, conflict policy) so the kind's `plan` / `apply`
 * see them as ambient context. Caller's `ctx` fields win over engine
 * options when both are set, since the caller may want per-context
 * overrides; in practice the orchestrator passes them only at the
 * engine layer.
 */
const enrichCtxForPush = (ctx: SyncContext, options: PushOptions): SyncContext => ({
  ...ctx,
  baselineStorage: ctx.baselineStorage ?? options.baselineStorage,
  pushConflictPolicy: ctx.pushConflictPolicy ?? options.conflictPolicy,
});

const enrichCtxForPull = (ctx: SyncContext, options: PullOptions): SyncContext => ({
  ...ctx,
  baselineStorage: ctx.baselineStorage ?? options.baselineStorage,
  pullConflictPolicy: ctx.pullConflictPolicy ?? options.conflictPolicy,
});

/**
 * Capture live remote state as a recipe (`sync pull`). The optional
 * `options` arg threads baseline + conflict-policy plumbing through
 * the kind's `readCurrent`; pure two-way pulls can omit it.
 */
export const syncPull = <T>(
  kind: RecipeKind<T>,
  ref: KindRef,
  ctx: SyncContext,
  options: PullOptions = {}
): Promise<T | null> => kind.readCurrent(ref, enrichCtxForPull(ctx, options));

/** Compute the plan to converge `ref` onto `desired` (`sync diff`). */
export const syncDiff = <T>(
  kind: RecipeKind<T>,
  desired: T,
  ref: KindRef,
  ctx: SyncContext
): Promise<RecipePlan> => kind.plan(desired, ref, ctx);

/**
 * Converge `ref` onto `desired` (`sync push`). Honors the write gate:
 * `what-if` returns the plan without calling `apply`, and a no-op plan
 * short-circuits the same way.
 */
export const syncPush = async <T>(
  kind: RecipeKind<T>,
  desired: T,
  ref: KindRef,
  ctx: SyncContext,
  options: PushOptions
): Promise<PushOutcome> => {
  const enrichedCtx = enrichCtxForPush(ctx, options);
  const fullPlan = await syncDiff(kind, desired, ref, enrichedCtx);
  const plan: RecipePlan = options.prune
    ? fullPlan
    : { changes: fullPlan.changes.filter((change) => change.kind !== "delete") };

  if (options.mode === "what-if" || planIsNoop(plan)) {
    return { plan, result: null };
  }
  if (enrichedCtx.signal?.aborted) {
    throw createScaiError("Sync cancelled before apply", "CANCELLED");
  }
  const result = await kind.apply(plan, ref, enrichedCtx);
  return { plan, result };
};
