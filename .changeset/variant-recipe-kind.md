---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Add `variant` recipe kind — brand-scoped sidecar variants for canonical renderings.

Implements the scai side of the `VariantRecipe` contract the registry schema defined. A `VariantRecipe` is a standalone recipe that adds **one** new variant to an existing rendering without mutating the canonical — schema-level enforcement of "recipe is sacred." It carries the canonical's handle + a PascalCase variant name + the TSX source for the head-repo sidecar file.

`compileVariantRecipe` emits exactly two Sitecore writes: the per-rendering `HEADLESS_VARIANTS` folder (idempotent — converges on the same folder the canonical's inline-variant emitter uses) and the `VARIANT_DEFINITION` item at `<headlessVariantsRoot>/<targetRendering.name>/<name>`. The tree is flat — section-grouping intermediaries break Pages chrome's two-level folder walk (verified live tenant 2026-05-31, see `emitVariants` in `component-template.ts`).

The `content` field on the recipe is **not** consumed by scai. It carries the TSX source through to the install descriptor / head-repo file-drop pipeline that writes the sidecar at `<canonical-dir>/<canonical-prefix>.<kebab(name)>.tsx`, where the Sitecore Content SDK's component-map generator (`prepareComponentsForMap`) auto-groups it with the canonical under one map entry. Keeping `content` on the recipe means one shape covers the orchestrator DB row, the install descriptor, and this recipe.

Wired into `compileRecipeSet` dispatch + the `compileRecipe` catch-all, with rank 1 (after rank-0 component templates so the topo sort runs the variant after its canonical when both happen to be in the same set) and `composition-structure` policy (`CreateAndUpdate` — re-pushes can update the variant's displayName; the canonical is untouched by the op set this kind emits).

11 unit tests cover IR shape, the flat-tree invariant, deterministic ids across compiles, the content-not-emitted contract, the `headlessVariantsRoot`-required behavior, and dispatch through the public `compileRecipe` entry point.
