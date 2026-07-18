---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): hoist section-independent shared folders into a stable `__shared-folders__` aggregate

The section-independent organisational folders — enumeration grouping folders (`location.folder`), Content Models group folders, and Page Templates group folders (`meta.tax.group`) — were emitted inline by the `ensure*` helpers into whichever recipe compiled first, deduped only by an in-memory sentinel. Because `--handles` scoping drops IRs _after_ compile, a batch chunk that excluded the arbitrary first-emitter left the folder-creation op behind, and the executor's path-walker then auto-created the folder as the generic `Folder` template. For enumeration grouping folders that is an author-visible bug: a generic `Folder` lacks the `Enumerations Folder` Standard Values, so right-clicking the folder in the editor offers no `Enumeration` insert option.

`compileRecipeSet` now emits these folders exactly once under the stable synthetic handle `__shared-folders__` (a FRONT aggregate, after `__enumeration-templates__` since the grouping folders conform to the shared `Enumerations Folder` template). The emission reuses the same `ensure*` helpers (the enum grouping-folder emission is extracted to `ensureEnumerationGroupingFolders`, called by both paths) with a fresh dedup set so it stays byte-for-byte identical; the per-recipe pass short-circuits via pre-seeded sentinels. `__shared-folders__` is added to `FRONT_AGGREGATE_HANDLES` so batch drivers carry it with chunk 1.

The section-scoped Component Folders / Presentation Parameters buckets are intentionally left on the per-recipe path — they nest under section folders that `ComponentSectionRecipe`s richly own as per-recipe IRs, and a FRONT aggregate would invert that ordering. Single-recipe compiles are unchanged (they still emit these folders inline).
