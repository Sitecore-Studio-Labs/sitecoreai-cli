---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: accept `allowedRenderingHandles` alias on inline placeholder slots

The registry-side recipe schema names this field
`allowedRenderingHandles` (handles ARE rendering handles, so the name
is more descriptive); scai's canonical name had stayed
`allowedComponents`. Recipes authored against the registry naming
silently dropped their slot-side restriction at compile time — the
field was present in the recipe JSON but ignored by both the compiler
and `validateRecipeSet`, so the Placeholder Settings item ended up
permissive (e.g. accordion-block's Headless `accordion-items-{*}`
slot accepted any rendering instead of restricting to
`accordion-item-rendering@1`).

`PlaceholderDefinitionSchema` now accepts both fields; a new
`resolveAllowedHandles` helper returns the de-duped union (source
order). Compiler + validator both route through the helper, so
recipes using either name compile to the same Sitecore artifact.
Validation messages normalise to `allowedRenderingHandles` so the
canonical name surfaces in author-facing errors.
