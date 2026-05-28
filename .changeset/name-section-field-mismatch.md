---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`scai brand sync push`: surface the section/field mismatch when every write skips

When `apply`'s field-PATCH loop produces zero applieds and a
non-zero skipped count, the operator previously saw
`Applied 0; N skipped` with no way to discover _why_ — the most
common cause (a recipe section/field name that doesn't match the
live kit) was invisible.

The diagnostic log now lists the recipe targets that didn't
resolve, the live kit's section list, and every section/field
mapping the live kit actually exposes. It also points at
`scai brand sync pull --kit "<name>"` so the operator can capture
the live shape and reconcile their recipe in one step. Pure
observability — no behaviour change for kits that apply cleanly.
