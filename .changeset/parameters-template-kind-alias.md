---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`loadRecipe`: accept `kind: "parameters-template"` as an alias for
`"design-parameters-template"`.

The registry and some older recipes spell the design-parameters-template
kind as `"parameters-template"`. `loadRecipe` now normalizes the kind
literal before zod parse so `RecipeSchema`'s discriminated union finds
the right variant. Rest of the pipeline (`RECIPE_APPLY_RANK`,
`compileRecipeSet` dispatch, executor) still only knows the canonical
`design-parameters-template` literal — the alias lives entirely at the
loader boundary.

Existing recipes using `"design-parameters-template"` are unaffected.
