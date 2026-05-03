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
 * ops; Phase 3+ adds `datasource-item` and `page-item`. Phase 4 adds
 * `composition-structure` for partials and page designs (registry-owned
 * compositional artifacts, like component templates — `CreateAndUpdate`).
 */
export type OpPurpose =
  | "template-structure"
  | "composition-structure"
  | "datasource-item"
  | "page-item";

const PURPOSE_BY_RECIPE_KIND: Record<Recipe["kind"], OpPurpose> = {
  "component-template": "template-structure",
  "content-template": "template-structure",
  "content-item": "datasource-item",
  // Standalone parameters templates and the synthesised inline-hoisted
  // ones share the same policy as component templates — they're
  // registry-owned and should overwrite tenant edits.
  "parameters-template": "template-structure",
  // Section definitions are typically tenant-pre-existing; the
  // compiler emits AppendToMultiList ops against them rather than
  // CreateItem. Treat as composition-structure so any future
  // `CreateItem` for a missing section definition lands with the
  // CreateAndUpdate policy.
  "section-definition": "composition-structure",
  "partial-design": "composition-structure",
  "page-design": "composition-structure",
  // Site templates are registry-owned brand definitions — the template
  // item itself + its structural metadata (insert options, designs, etc.)
  // are template-structure-shaped. Compiler implementation lands in
  // composition-recipes-site-branches.md Milestone C.
  "site-template": "composition-structure",
  // Site instances are operator-driven — the site item is created via
  // Sites API and its grouping / overrides are operator overrides on
  // top of the template defaults. Treat as composition-structure for
  // policy purposes; per-op CreateOnly vs CreateAndUpdate gets
  // refined when the executor lands (Milestone D).
  site: "composition-structure",
  // Enumerations are registry-owned vocabulary. CreateAndUpdate so
  // re-pushes flip displayName edits and add/remove value items as
  // the recipe evolves. Authors who need extra values can add them
  // to the recipe and re-push; CMS edits to enumeration items get
  // overwritten.
  enumeration: "template-structure",
};

export const purposeForRecipe = (kind: Recipe["kind"]): OpPurpose => PURPOSE_BY_RECIPE_KIND[kind];

/**
 * Policy assignment, given the purpose of the op being emitted. Phase 1
 * collapses to a single value; future phases add branches here.
 */
export const policyFor = (purpose: OpPurpose): PushPolicy => {
  switch (purpose) {
    case "template-structure":
    case "composition-structure":
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
