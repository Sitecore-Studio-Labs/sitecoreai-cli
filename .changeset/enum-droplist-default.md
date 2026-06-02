---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`resolveSitecoreType`: default `shape: "enum"` fields with inline
`values: [...]` and no `enumHandle` to `type: "droplist"`.

Previously the default was `droplink`, which requires `sitecore.enumHandle`
pointing at a shared `EnumerationRecipe`. Authors who wrote inline `values`
had no shared enum to point at, so compile threw INPUT_INVALID and demanded
they add a redundant `sitecore.type: "droplist"` to every enum field.

Now the default tracks intent: inline `values` → droplist (pipe-list Source).
Authors who want droplink + shared enum still get it: declare `enumHandle`
without inline `values`, and the shape-based default (`droplink`) stands.

Authors who explicitly set `sitecore.type` are unaffected.
