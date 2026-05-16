/**
 * Plan types for the `sync` engine — the diff between a desired recipe
 * and live remote state.
 *
 * Pure leaf module: no I/O, no domain imports. `diff` implementations
 * produce a `RecipePlan`; the engine and CLI consume it.
 *
 * See docs/recipe-sync-architecture.md.
 */

/** What a single change does to one element of a recipe. */
export type ChangeKind = "create" | "update" | "delete" | "noop";

/** One element-level change in a sync plan. */
export interface RecipeChange {
  kind: ChangeKind;
  /** Dotted path to the element, e.g. `sections.voice.tone`. */
  path: string;
  /** One-line, human-readable description of the change. */
  summary: string;
  /** Prior value — present when the change replaces or removes something. */
  before?: unknown;
  /** Intended value — present when the change creates or replaces something. */
  after?: unknown;
  /**
   * Kind-specific structured data — set by `diff`, read by `apply` so
   * `apply` can act on a change without re-parsing the `path` string.
   */
  meta?: Record<string, unknown>;
}

/** The full set of changes needed to converge a target onto a recipe. */
export interface RecipePlan {
  changes: RecipeChange[];
  /**
   * Kind-private plan→apply handoff. A kind whose `plan` already did
   * expensive work (compilation, IR construction) may stash that work
   * here so `apply` can reuse it without recomputing. The engine never
   * inspects this field — it is opaque transport between one kind's
   * `plan` and the same kind's `apply`. Simple kinds (brand-kit,
   * brief-type, campaign) leave it unset; the recipe (Sitecore-item)
   * kind uses it to carry its compiled `OperationIr[]`.
   */
  payload?: unknown;
}

/** Per-`ChangeKind` tally of a plan's changes. */
export interface PlanSummary {
  create: number;
  update: number;
  delete: number;
  noop: number;
}

/** Count a plan's changes by kind. */
export const summarizePlan = (plan: RecipePlan): PlanSummary => {
  const summary: PlanSummary = { create: 0, update: 0, delete: 0, noop: 0 };
  for (const change of plan.changes) {
    summary[change.kind] += 1;
  }
  return summary;
};

/** A plan is a no-op when nothing would actually be written. */
export const planIsNoop = (plan: RecipePlan): boolean =>
  plan.changes.every((change) => change.kind === "noop");

/** The changes that would write to the remote (everything but `noop`). */
export const writingChanges = (plan: RecipePlan): RecipeChange[] =>
  plan.changes.filter((change) => change.kind !== "noop");
