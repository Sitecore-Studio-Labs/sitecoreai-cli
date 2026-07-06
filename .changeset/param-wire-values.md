---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Page layouts now store rendering-parameter values in the wire form their parameters-template fields expect, so XM Cloud Pages' properties panel displays them as set (raw names previously read back as unset):

- **Enum-backed Droplink params** carry the enum-value item's GUID (`Layout=%7B…%7D`) instead of the raw name — same convention Pages itself writes; plan-time captured-id substitution resolves the refKey to the real tenant item, and Edge's rendering-params resolution maps it back to the value for the front end.
- **Checkbox params** carry `1`/`""` instead of `true`/`false` — a checkbox field holding the literal `true` displays as unchecked.
- Droplist-typed params (pipe-list Source) and free-text params keep raw values. Param definitions resolve through the component's inline `params` or its external `parameters: { handle }` recipe via the new `parametersByHandle` compile-context map; standalone compiles pass values through unchanged.
