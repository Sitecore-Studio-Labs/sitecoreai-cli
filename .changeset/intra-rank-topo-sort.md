---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`compileRecipeSet`: order recipes topologically within each apply-rank.

Previously, recipes that shared an apply-rank (e.g. `ComponentTemplate` and
`ContentTemplate`, both rank 0) were ordered by stable file-glob order. A
referencing recipe whose filename sorted alphabetically before its referent
(e.g. `accordion-block.recipe.ts` < `faq-content.recipe.ts`) would fail at
push time with `ref-source-fields references handle 'faq-content@1'; not yet
in captured map` because the dependent's `field.sitecore.source.types: [...]`
emitted before the dependency's `CreateItem`.

Replace the coarse rank-only sort with stable Kahn topological sort within
each rank group. `extractRecipeDependencies` mirrors `validate.ts`'s
reference inventory across every recipe kind. Producer recipes emit before
consumers; unrelated siblings preserve input order; cycles (shouldn't reach
this layer) degrade gracefully to input order.

No behaviour change for recipe sets without intra-rank cross-references.
