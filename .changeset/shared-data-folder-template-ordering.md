---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix recipe-push abort when ≥2 component recipes share a site-scoped datasource subfolder.

The shared Data Folder coalescer (`buildSharedDataFoldersAggregate`) emitted the SHARED `<Subfolder> Data Folder` template AND its Insert Options `SetField` in a single synthetic IR placed AFTER the per-recipe IRs. But each recipe's `site-data-folder:<site>:<subfolder>` folder ITEM is created with `templateOf = sharedDataFolderTemplateId(...)`, so at apply time Authoring GraphQL aborted with "Cannot find a template with the `<id>` id" — the shared template hadn't been created yet. That rolled back the owning recipe (the alphabetically-first contributor), which also owns the section's Presentation Parameters bucket it created, cascading "item not found" into every sibling recipe sharing the section.

Split the aggregate so its two halves sit on opposite sides of the per-recipe IRs:

- Template creation (CreateItem template + SV + base-templates + SetStandardValues) is **prepended** to the IR list — `__shared-data-folders__` now runs before any folder ITEM that references the shared template via `templateOf`.
- Insert Options `SetField` moves to a new `__shared-data-folder-insert-options__` IR **appended** after the per-recipe IRs, because its `ref-recipe-list` references each contributing recipe's datasource template (created by those recipes).

Manifests as a real failure in the registry's cards-and-lists families (e.g. `Articles`, shared by `article-card` + `articles-list-grid` + `articles-carousel`). Adds a regression test asserting the shared-template IR precedes every `site-data-folder:` folder-item IR and the Insert Options IR follows them.
