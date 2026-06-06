# Page-design schema reconciliation with registry — handoff brief

**Date opened:** 2026-06-06
**Opened from:** registry session that added `PageDesignRecipe` + `PageItemTemplateRecipe.pageDesign`
**Registry-side update 2026-06-06:** Option A's registry-side changes have landed. The registry now uses scai's vocabulary (`page-template` / `page` kinds; `appliesTo` on `PageDesignRecipe`; no `pageDesign` ref on the template). Only the scai-side verification work below remains.
**Owner on next pickup:** the next scai session (run this from the scai checkout, not from the registry checkout)

## TL;DR

The registry (`/Users/nels/Projects/registry`) added a `PageDesignRecipe` and a `pageDesign` ref on its page template recipe today. **scai already has `PageDesignRecipeSchema`**, so this is NOT a missing-mirror problem — it's a **schema-divergence problem**. The two sides disagree on (a) the names of the page-template and page-instance recipe kinds and (b) which side of the binding owns the template→design link.

Until reconciled, the new registry reference experiences (`standard-page@1`, `homepage-demo@1`, and the `pageDesign: { handle: "standard-page@1" }` reference on `page@1`) will not validate against scai. `recipe_sync` will reject them at parse time.

## What landed in the registry (2026-06-06)

| File                                                                                     | What changed                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/registry/sitecore-recipes.ts`                                                   | Added `PageDesignRecipe` (kind `"page-design"`, `partials: HandleString[]`, `layout: Layout` required, `superRefine` rejects `datasourceRef.kind: "scoped"`); added optional `pageDesign: { handle }` to `PageItemTemplateRecipe`; wired into the top-level `Recipe` union. |
| `src/components/registry/experiences/page-designs/standard-page/standard-page.recipe.ts` | Reference page-design — `standard-header@1` + `standard-footer@1`, pre-places `container@1` at `headless-main`.                                                                                                                                                             |
| `src/components/registry/experiences/page-items/homepage-demo/homepage-demo.recipe.ts`   | Reference page-item using `template: { handle: "page@1" }` (which is `kind: "page-item-template"`), drops `hero@1` + `features-list-grid@1` into `container-1`.                                                                                                             |
| `src/components/registry/experiences/page.recipe.ts`                                     | Now declares `pageDesign: { handle: "standard-page@1" }` on the shared `Page` template.                                                                                                                                                                                     |
| `scripts/registry/generate-recipe-schemas.ts`                                            | Emits `page-design.schema.json` for Agent Studio.                                                                                                                                                                                                                           |
| `scripts/registry/generate-registry-entries.ts`                                          | Knows the `page-design` / `partial-design` kinds so orphan recipes get a descriptive `description` field.                                                                                                                                                                   |

Registry-side JSON Schema lives at `src/registry-content/schemas/page-design.schema.json`.

## The three divergences

### 1. Recipe-kind names

| Concept        | registry                                                | scai                                                     |
| -------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| Page template  | `PageItemTemplateRecipe` — `kind: "page-item-template"` | `PageTemplateRecipeSchema` — `kind: "page-template"`     |
| Page instance  | `PageItemRecipe` — `kind: "page-item"`                  | `PageRecipeSchema` — `kind: "page"`                      |
| Page design    | `PageDesignRecipe` — `kind: "page-design"` ✓            | `PageDesignRecipeSchema` — `kind: "page-design"` ✓       |
| Partial design | `PartialDesignRecipe` — `kind: "partial-design"` ✓      | `PartialDesignRecipeSchema` — `kind: "partial-design"` ✓ |

So `homepage-demo@1` ships with `kind: "page-item"` and a `template: { handle: "page@1" }` ref pointing at a `kind: "page-item-template"` recipe — both rejected by scai's `RecipeSchema` discriminated union.

### 2. Template ↔ design binding direction

SXA stores the binding in **two** redundant places:

- **`TemplatesMapping`** field on the Page Designs root — design GUID → list of template GUIDs.
- **`__Page Design`** field on the page template's Standard Values — single design GUID, per-template override.

Sitecore reads the Standard Values field at render time when resolving a page item's design; `TemplatesMapping` is the authoring-side mapping.

**registry's choice (template-side):** `PageItemTemplateRecipe.pageDesign: { handle }`. Compiler is expected to write the resolved GUID to the template's Standard Values `__Page Design` field.

**scai's choice (design-side):** `PageDesignRecipeSchema.appliesTo: HandleString[]`. `compileRecipeSet` aggregates `appliesTo` arrays across all `PageDesignRecipe`s in a set, then emits one combined `TemplatesMapping` field on the Page Designs root (see `src/recipe/compile/page-design.ts` lines 20–35 for the comment explaining why the per-recipe approach would full-replace).

These two approaches are **semantically equivalent** in SXA (both end up writing both fields if done right) but they aren't compatible at the recipe layer without a translation step.

### 3. Required vs optional fields on `PageDesignRecipe`

| Field                       | registry                               | scai                                                    |
| --------------------------- | -------------------------------------- | ------------------------------------------------------- |
| `partials`                  | `default([])`                          | `default([])` ✓                                         |
| `layout`                    | required `Layout`                      | `LayoutSchema.optional()`                               |
| scoped-datasource rejection | `superRefine` rejects `kind: "scoped"` | (verify — likely enforced in `compileLayoutPlacements`) |
| `appliesTo`                 | (absent)                               | required-with-default                                   |

## Three reconciliation options

### Option A: registry adopts scai's names + design-side binding (recommended)

scai's vocabulary is the established one — it has runtime consumers (recipe_sync, recipe-sandbox, MCP tools, the brief/campaign/agent recipe family). The registry's `PageItemTemplateRecipe` / `PageItemRecipe` names were introduced today in a single commit with one consumer recipe file each.

**Registry-side changes:**

1. Rename `PageItemTemplateRecipe` → `PageTemplateRecipe`, kind `page-item-template` → `page-template`.
2. Rename `PageItemRecipe` → `PageRecipe`, kind `page-item` → `page`. Update `page.recipe.ts`, `homepage-demo.recipe.ts`, and the entries generator's `isPageItem`/`isPageItemTemplate` branches.
3. Drop `pageDesign` from `PageItemTemplateRecipe`. Move the design→template binding to `PageDesignRecipe.appliesTo: HandleString[]`.
4. Update `standard-page.recipe.ts` to declare `appliesTo: ["page@1"]`.
5. Make `layout` optional on `PageDesignRecipe` to match scai. Keep the `superRefine` scoped-datasource check.
6. Regenerate JSON Schemas + entries.

**scai-side changes:**

1. None to the schema itself.
2. Verify `superRefine` parity — either copy the scoped-datasource check from registry into `PageDesignRecipeSchema`, or confirm `compileLayoutPlacements` already rejects it with a useful error.
3. Run `recipe_sync` end-to-end with the new registry experiences once they're renamed.

**Pros:** Smallest scai-side change. Aligns the registry with the system of record. Brings registry into the established naming convention so future recipe types stay consistent.
**Cons:** Registry has to rename two types and two recipes — but only today's work is affected; nothing downstream consumes them yet.

### Option B: scai adopts registry's names + template-side binding

Migrate scai's `PageTemplateRecipeSchema` → `PageItemTemplateRecipeSchema`, `PageRecipeSchema` → `PageItemRecipeSchema`. Move `appliesTo` off `PageDesignRecipeSchema` and add `pageDesign` to the template schema. Update `compilePageDesignRecipe` + `compilePageTemplateRecipe` (rename and rewrite the write site).

**Pros:** Registry's names are arguably clearer ("page item" disambiguates from "page template" more obviously than "page" vs "page-template").
**Cons:** Large scai-side churn. Affects `recipe_sync`, `recipe-sandbox`, MCP tool definitions, every existing test, every downstream consumer of `PageRecipe` / `PageTemplateRecipe` in the SDK, and all docs. Several days of work for what is mostly a vocabulary preference.

### Option C: keep both, add a translation layer

`recipe_sync` accepts either kind set and converts at parse time. `page-item-template` ↔ `page-template` and `page-item` ↔ `page`. `pageDesign` on a template gets desugared into `appliesTo` on the corresponding design.

**Pros:** Zero schema breakage either side.
**Cons:** Two ways to do everything is the root of every subtle install bug we'll hit for the next year. Tooling has to know about both names. Doc site has to teach both. **Strongly avoid.**

## Recommended path: Option A

1. ~~**(registry side)** Rename `PageItemTemplateRecipe` → `PageTemplateRecipe`, `PageItemRecipe` → `PageRecipe`. Move `pageDesign` template ref → `appliesTo` array on `PageDesignRecipe`. Update `page.recipe.ts`, `standard-page.recipe.ts`, `homepage-demo.recipe.ts`, and the entries generator. Regenerate schemas + entries.~~ **Done 2026-06-06.** Folder `experiences/page-items/` → `experiences/pages/` too. JSON Schemas regenerated; stale `page-item*.schema.json` removed. Typecheck + recipe-discovery test pass.
2. **(scai side, this brief's owner)** Run `superRefine` audit on `PageDesignRecipeSchema` — either add the scoped-datasource rejection or document where it's enforced in compile. Verify `compilePageDesignRecipe` parses and compiles the registry's `standard-page@1` (now ships with `appliesTo: ["page@1"]`).
3. **(integration)** Run an end-to-end `recipe_sync` against a sandbox tenant with the registry recipes to confirm `standard-page@1` lands as a Page Design item with `PartialDesigns` populated, and `homepage-demo` (kind `page`) lands as a page that inherits the design via the Page Designs root `TemplatesMapping`.
4. **(this brief)** Delete after step 3 lands and `recipe_sync` integration is green.

## Pre-existing context worth knowing before picking this up

- scai's `compilePageDesignRecipe` (`src/recipe/compile/page-design.ts`) emits up to 3 ops: `CreateItem` (Page Design template), `SetField(PartialDesigns)`, `SetField(__Renderings)` for the design's own layout. The `TemplatesMapping` aggregation happens in `compileRecipeSet` (the cross-recipe coordinator), NOT in this per-recipe function — see the comment block at lines 21–35 of that file.
- Registry-side memory file at `~/.claude/projects/-Users-nels-Projects-registry/memory/project_page_design_recipe_scai_mirror.md` currently says "scai needs the matching PageDesignRecipeSchema." That's wrong — scai already has it. Update or remove that memory once Option A lands.
- The handle space (`standard-header@1`, `standard-footer@1`) is already shared between sides. The registry's `standard-page@1` page-design handle slots cleanly into scai's existing `partialDesignId(site, handle)` / `pageDesignId(site, handle)` GUID derivation.
