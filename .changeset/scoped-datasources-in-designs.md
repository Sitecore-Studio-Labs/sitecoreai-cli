---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Partial designs and page designs can now host their own `scoped` datasources. Previously the compiler rejected `kind: "scoped"` on any layout that wasn't a page (`recipe-push failed: [INPUT_INVALID] scoped datasourceRef is invalid in this layout context`), forcing design chrome to use `shared` content items even when the content belongs to that one design. A design item is a valid datasource host: scoped slots now materialise at `<partial-design>/Data/<slot>` (and `<page-design>/Data/<slot>`), shared by every page that uses the design — the same mechanism pages already use at `<page>/Data/<slot>`.

Unlike a page (which references its slots with the page-relative `ds="local:/Data/<slot>"` form because the page IS the render context), a design references its slot by absolute GUID — a partial's render context is the page, so `local:` would resolve under the page and miss the item. The materialisation is shared via `compile/scoped-datasources.ts`. Mixed layouts (some `scoped`, some `shared`, some `none`) work per-placement.
