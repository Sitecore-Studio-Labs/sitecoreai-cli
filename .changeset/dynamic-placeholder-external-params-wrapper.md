---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`ComponentTemplateRecipe`: support `dynamicPlaceholders: true` combined with
an external `parameters: { handle }` reference.

Previously, scai rejected this combination because chaining
`_IDynamicPlaceholder` onto the external shared parameters template would
mutate behaviour for every other consumer. Authors had to inline the params
on every recipe that wanted dynamic placeholders, losing the shared-template
benefit.

Now the compiler emits a thin per-recipe **wrapper** parameters template
that inherits FROM the external shared template AND adds
`_IDynamicPlaceholder`. The external template's base-template chain isn't
mutated; the wrapper has no own fields (everything inherits via Sitecore
template inheritance); the rendering's `Parameters Template` field points
at the wrapper instead of the external directly. The wrapper's GUID is
`designParametersTemplateId(site, recipe.handle)` — same as the inline-
params synthesis (they're mutually exclusive).

Behaviour for recipes that already work (inline-params-only OR
external-params-without-dynamic-placeholders) is unchanged. Recipes that
previously failed with the `combines dynamicPlaceholders + external
parameters template` error now compile.
