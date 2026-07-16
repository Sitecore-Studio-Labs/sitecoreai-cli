---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix repeat `recipe push` aborting with `The item name "<x>" is already defined on this level` on variants-folder ops: children reads now paginate (the Authoring API returns only the first page for argument-less `children` queries, blinding sibling matching for parents with many children), sibling name matching uses Sitecore's case-insensitive per-level semantics, and FOLDER-class items with a differing live template are adopted instead of duplicated (the datasource rebind guard is unaffected). Self-healing — no tenant cleanup needed.
