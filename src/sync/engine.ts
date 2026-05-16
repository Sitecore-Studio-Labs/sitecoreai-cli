/**
 * The `sync` engine — kind-agnostic pull / diff / push over any
 * `RecipeKind`. The engine owns the write-consent gate, so individual
 * kinds never decide whether they are allowed to write.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { createScaiError } from "@/shared/errors";
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
}

export interface PushOutcome {
  /** The plan that was computed (deletes filtered out unless `prune`). */
  plan: RecipePlan;
  /** The apply result — `null` under `what-if` or for a no-op plan. */
  result: ApplyResult | null;
}

/** Capture live remote state as a recipe (`sync pull`). */
export const syncPull = <T>(
  kind: RecipeKind<T>,
  ref: KindRef,
  ctx: SyncContext
): Promise<T | null> => kind.readCurrent(ref, ctx);

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
  const fullPlan = await syncDiff(kind, desired, ref, ctx);
  const plan: RecipePlan = options.prune
    ? fullPlan
    : { changes: fullPlan.changes.filter((change) => change.kind !== "delete") };

  if (options.mode === "what-if" || planIsNoop(plan)) {
    return { plan, result: null };
  }
  if (ctx.signal?.aborted) {
    throw createScaiError("Sync cancelled before apply", "CANCELLED");
  }
  const result = await kind.apply(plan, ref, ctx);
  return { plan, result };
};
