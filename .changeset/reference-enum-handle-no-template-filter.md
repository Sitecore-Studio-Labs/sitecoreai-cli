---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: drop `IncludeTemplatesForSelection` filter from `reference + enumHandle` Treelist sources

Sitecore Pages's Treelist chrome rejects every pick under the combined
`DataSource=<path>&IncludeTemplatesForSelection=<GUID>` form, leaving
authors with "the source's filter doesn't allow those options" and no
recovery path on any field whose recipe declares
`shape: "reference"` + `sitecore.enumHandle`. The template filter
wasn't load-bearing — scai deliberately doesn't emit per-folder
`__Standard Values` items inside enum folders, so the enum folder's
children are exactly the value items the picker should surface.
Switched the compile to emit plain `DataSource=<enumPath>`.
Regression-tested in `compile-shared.test.ts`.
