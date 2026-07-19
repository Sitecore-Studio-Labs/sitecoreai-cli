---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): converge partial-design scoped datasource slots on template drift

A partial-design scoped datasource slot (`<design>/Data/<slot>`, e.g. a
`header-start-0` that was a text `utility-trigger` and is now an image
`image@1`) is `CreateAndUpdate` but its backing template changes when the
slot's component changes between pushes. The stale item was field-updated in
place and the new component's field write aborted the whole push with
"Cannot find a field with the name X" (exit 6, rolled back). Scoped slots now
opt into the existing adopt-and-retemplate convergence via
`convergeOnTemplateDrift`, so the item is retemplated in place (preserving its
GUID and the `local:/Data/<slot>` reference) instead of aborting.
