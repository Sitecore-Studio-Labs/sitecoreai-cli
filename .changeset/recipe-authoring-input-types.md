---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(recipe): exported `<Kind>Recipe` types are now the authoring (`z.input`) shape

The public recipe-kind types (`ComponentTemplateRecipe`, `EnumerationRecipe`,
`ContentTemplateRecipe`, and every other kind exported from
`@sitecoreai-labs/sitecoreai-cli/recipe` and `/recipe/unstable`) are now derived
with `z.input` instead of `z.infer`. Every field the schema gives a
`.default(...)` — `fields`, `variants`, `params`, an empty `datasource.query`,
`dynamicPlaceholders`, etc. — is now **optional** when authoring an object
literal, so `{ ... } satisfies ComponentTemplateRecipe` no longer forces you to
spell out defaults you don't care about. This matches the documented authoring
pattern and lets external consumers (the registry, generated starter repos,
hand-rolled recipes) import the recipe types directly with no boilerplate and no
local re-derivation shim.

The compiler is unaffected: it always operates on the parsed, defaults-present
shape, now named explicitly as `<Kind>RecipeParsed` (`z.output`) and used for
all compiler-internal helpers and the `read-current` / `pull` serialization
paths. No runtime behavior changes; the full unit + integration suite (recipe
compile and pull round-trips included) passes unchanged.
