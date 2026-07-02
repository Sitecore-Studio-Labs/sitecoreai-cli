---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Add `scai provision recipe list` — pure-logic recipe discovery (no tenant/creds) that loads the recipe set, orders it by cross-recipe apply-rank (the same order `push` applies in), and emits `{ handle, kind }` per recipe (with `--json`). Lets a driver split a large push into dependency-safe `--handles` batches without re-deriving the recipe graph.
