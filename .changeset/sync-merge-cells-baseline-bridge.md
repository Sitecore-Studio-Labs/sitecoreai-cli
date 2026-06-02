---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`sync` + `recipe/runtime/baseline`: two internal seams for multi-kind
baseline + per-cell-merge sharing.

**`src/sync/merge-cells.ts` (new export):** `classifyCellHashMaps` +
`resolveCellByPolicy` — generic per-cell three-way classifier + push
policy resolver, factored out of the brand and campaign baseline
modules (which each carried character-identical copies). Brand and
campaign now delegate; brief stays standalone (single-cell helper, no
shape to share).

**`adaptSyncBaselineStorage(sync) -> BaselineStorage` (new export):**
adapter that pins `kind: "content-recipe"` so a multi-kind sync
`BaselineStorage` (e.g. `HttpBaselineStorage`) can back the
content-recipe 2-arg surface. One orchestrator-side store can now
serve brand / brief / campaign / story AND content recipes without
recipe-side callsite changes. `CONTENT_RECIPE_BASELINE_KIND` is
exported as the stable discriminator (serialised into orchestrator
URLs / column values).

No behavior change for existing consumers.
