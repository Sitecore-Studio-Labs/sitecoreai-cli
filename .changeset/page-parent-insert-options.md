---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Installed pages register their template in the parent item's Insert
Options, and page templates drop the redundant explicit Standard
template base.

- `compilePageRecipe` now emits a merge-unique `AppendToMultiList` on
  the page's PARENT item's `__Masters`, appending the page's template.
  The Pages editor's "Create page (+)" flow lists exactly the selected
  node's insert options — without this, installed page types never
  appeared there. Item-level (not template standard-values) because the
  parent usually conforms to the tenant-owned collection `Page`
  scaffold; `latePath` resolves pre-existing parents, and the append is
  additive + idempotent on re-push.
- Page-template base templates are now EXACTLY the five SXA page facets
  (`Base Page`, `_Navigable`, `_Taggable`, `_Designable`, `_Sitemap`) —
  the explicit Standard template entry is dropped since `Base Page`
  chains it transitively.
