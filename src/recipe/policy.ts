import type { Operation, PushPolicy } from "./ir/operations";
import type { Recipe } from "./schema/recipe";

/**
 * Policy assignment for compiler-emitted operations.
 *
 * Phase 1: every op a recipe emits is `CreateAndUpdate` — the registry is
 * the source of truth for templates, sections, fields, renderings, and
 * variants. Authors should not edit those in the CMS; if they do, a
 * registry deploy overwrites.
 *
 * Phase 3 (datasource items, page items) introduces `CreateOnly`: the
 * registry seeds initial content, the CMS owns it thereafter. The
 * `policyFor` switch is the single seam to add that distinction without
 * rewriting every emission site in `compile.ts`.
 */

/**
 * The kind of op being emitted. Phase 1 only has `template-structure`
 * ops; Phase 3+ adds `datasource-item` and `page-item`.
 */
export type OpPurpose = "template-structure" | "datasource-item" | "page-item";

const PURPOSE_BY_RECIPE_KIND: Record<Recipe["kind"], OpPurpose> = {
  "component-template": "template-structure",
  "content-template": "template-structure",
  "content-item": "datasource-item",
};

export const purposeForRecipe = (kind: Recipe["kind"]): OpPurpose => PURPOSE_BY_RECIPE_KIND[kind];

/**
 * Policy assignment, given the purpose of the op being emitted. Phase 1
 * collapses to a single value; future phases add branches here.
 */
export const policyFor = (purpose: OpPurpose): PushPolicy => {
  switch (purpose) {
    case "template-structure":
      return "CreateAndUpdate";
    case "datasource-item":
    case "page-item":
      return "CreateOnly";
  }
};

/**
 * Convenience: the default policy a recipe of the given kind should attach
 * to every op it emits. Compiler call site:
 *
 *   const policy = defaultPolicyForRecipe(recipe.kind);
 *   operations.push({ op: "CreateItem", policy, ... });
 */
export const defaultPolicyForRecipe = (kind: Recipe["kind"]): PushPolicy =>
  policyFor(purposeForRecipe(kind));

/**
 * Type guard for narrowing op kinds — exposed so consumers (planner,
 * executor, telemetry) can dispatch on policy without re-implementing the
 * mapping.
 */
export const policyForOp = (op: Operation): PushPolicy => op.policy;
