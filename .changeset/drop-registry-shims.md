---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`recipe`: drop three registry-compat shims (breaking).

Three shims that 0.2.5 added for the Sitecore Showcase Design System
have been removed. The registry recipes have been authoring against the
canonical shape for a while, so none of the shim paths were exercised
in practice — but anyone who was relying on them needs to migrate.

**Removed:**

- `loadRecipe` no longer accepts `kind: "parameters-template"` as an
  alias for `"design-parameters-template"`. Recipes must spell the kind
  canonically. (Was added in 0.2.5; never used by the registry.)

- `resolveSitecoreType` no longer defaults `shape: "enum"` fields with
  inline `values: [...]` and no `enumHandle` to `type: "droplist"`.
  Authors must declare `sitecore.type: "droplist"` explicitly. (The
  inline-Droplink rejection — "neither droplist nor enumHandle" — that
  was already in `resolveFieldSource` is the new behavior.)

- `ComponentTemplateRecipe` no longer combines an external
  `parameters: { handle }` with `dynamicPlaceholders: true`. The
  per-recipe wrapper template synthesis that 0.2.5 added has been
  removed; the validator now surfaces this combination as
  `INPUT_INVALID` with a clear remediation hint. Inline the params via
  `params:` (the `_IDynamicPlaceholder` base chains onto the
  synthesised per-recipe template directly) or drop
  `dynamicPlaceholders` from the consumer.

**Migration:**

- `kind: "parameters-template"` → `kind: "design-parameters-template"`
- inline-values enum params without `sitecore.type` → add `sitecore.type: "droplist"`
- external `parameters: { handle }` + `dynamicPlaceholders: true` → inline `params: [...]` on the consumer

Recipes using only canonical shapes (the registry's recipes today) are
unaffected.
