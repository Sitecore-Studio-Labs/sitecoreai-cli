---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(brand): carry logo through the three-way merge so updates reach Sitecore

A changed brand-kit logo synced on CREATE but never on UPDATE. CREATE skips
the three-way merge (current is null), so `diffBrandKit` saw the logo and
PATCHed it. UPDATE runs `mergeBrandByPolicy`, which rebuilt the merged recipe
without the `logo` field — leaving `merged.logo` undefined, so `diffBrandKit`'s
`desired.logo !== undefined` guard never fired and the new logo was silently
dropped. The merge now passes the recipe-author logo through verbatim (like
`sectionProperties`); logo has its own dedicated diff/apply path and isn't part
of the cell-based classification.
