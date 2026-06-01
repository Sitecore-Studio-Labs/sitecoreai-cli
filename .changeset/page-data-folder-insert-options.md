---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: stamp page Data folder Insert Options (`__Masters`) from the page's rendering datasource templates

A `PageRecipe` with `placements[]` referencing rendering datasource templates materialised the `<page>/Data` folder as a bare `FOLDER` item with no `__Standard Values` `__Masters` field. Authors who turned off `autoCreate` on a rendering — or wanted to create another datasource later from the Sitecore Pages tree — saw an empty right-click Insert menu.

`compile/page.ts` now walks every placement, collects the union of the rendering's `datasource.templates[]` / `datasource.template` / inline-fields handles (deduped, first-seen order), and emits a `SetField` op writing those template GUIDs as a `ref-recipe-list` into the Data folder's `__Masters` shared field. The resolver uses `tolerateMissing: true` so standalone single-recipe compiles still emit the field; multi-component pages get one entry per unique template across all placements.

Three new tests in `tests/unit/recipe/page-level.test.ts` cover: union resolution across `templates[]` + `template` + inline-fields fallbacks (deduped across placements), no-emit when the page has no scoped slots, and `tolerateMissing` standalone compile.
