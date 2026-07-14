import type { Operation, PushPolicy } from "../ir/operations";
import type { Recipe } from "../schema/recipe";

/**
 * Policy assignment for compiler-emitted operations.
 *
 * Template structure (templates, sections, fields, renderings, variants)
 * uses `CreateAndUpdate` — the recipe is the source of truth; if an
 * author edits the corresponding CMS item, the next push overwrites.
 *
 * Datasource items + page items use `CreateOnly` — the recipe seeds
 * initial content, the CMS owns it thereafter. The `policyFor` switch
 * is the single seam adding this distinction without rewriting every
 * emission site in `compile.ts`.
 */

/**
 * The kind of op being emitted. `template-structure` covers component
 * + content + page templates; `composition-structure` covers partial
 * designs and page designs (still recipe-owned, `CreateAndUpdate`);
 * `datasource-item` + `page-item` cover seeded content (`CreateOnly`).
 */
export type OpPurpose =
  "template-structure" | "composition-structure" | "datasource-item" | "page-item";

const PURPOSE_BY_RECIPE_KIND: Record<Recipe["kind"], OpPurpose> = {
  // Component sections own organisational folders that components live
  // under (templates section folder, renderings section folder, etc.).
  // Registry-owned structure — CreateAndUpdate so re-pushes can update
  // the section's display name / icon / sort order.
  "component-section": "template-structure",
  "component-template": "template-structure",
  "content-template": "template-structure",
  "content-item": "datasource-item",
  // Page templates are registry-owned data templates (with SXA page
  // base inheritance + a layout-bearing standard values item) —
  // template-structure, same CreateAndUpdate posture as component
  // and content templates.
  "page-template": "template-structure",
  // A page is author-owned content — the registry seeds the page item
  // and its layout; authors own it thereafter. CreateOnly (via the
  // `page-item` purpose) so a re-push never clobbers author edits.
  page: "page-item",
  // Placeholder Settings items are registry-owned composition
  // scaffolding — CreateAndUpdate so re-pushes can widen/narrow the
  // Allowed Controls whitelist as the recipe set evolves.
  placeholder: "composition-structure",
  // Standalone parameters templates and the synthesised inline-hoisted
  // ones share the same policy as component templates — they're
  // registry-owned and should overwrite tenant edits.
  "design-parameters-template": "template-structure",
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
  // Dictionaries are registry-owned phrase libraries. CreateAndUpdate
  // so re-pushes replace authored Phrase values when the recipe
  // changes — keeping the registry as the source of truth for
  // shareable copy. Per-site `dictionaryOverrides` still applies
  // through the SiteRecipe compile path.
  dictionary: "composition-structure",
  // Enumerations are registry-owned vocabulary. CreateAndUpdate so
  // re-pushes flip displayName edits and add/remove value items as
  // the recipe evolves. Authors who need extra values can add them
  // to the recipe and re-push; CMS edits to enumeration items get
  // overwritten.
  enumeration: "template-structure",
  // Workflows + webhook authorizations are registry-owned tenant-wide
  // structure. CreateAndUpdate so re-pushes update state/command labels,
  // webhook URLs, and authorization metadata as the recipe evolves.
  workflow: "composition-structure",
  "webhook-authorization": "composition-structure",
  // Brand-scoped sidecar variants are registry-owned scaffolding: the
  // per-rendering Headless Variants folder + the VARIANT_DEFINITION item.
  // CreateAndUpdate so re-pushes can update the displayName as the
  // brand variant's recipe evolves; the canonical rendering is
  // untouched by the same op set.
  variant: "composition-structure",
};

export const purposeForRecipe = (kind: Recipe["kind"]): OpPurpose => PURPOSE_BY_RECIPE_KIND[kind];

/**
 * Policy assignment, given the purpose of the op being emitted.
 * Template + composition structure → `CreateAndUpdate` (recipe-owned);
 * datasource + page items → `CreateOnly` (recipe-seeded, CMS-owned).
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
