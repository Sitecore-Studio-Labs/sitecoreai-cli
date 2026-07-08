---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix batched/chunked `recipe push --handles` failing with `ref-source-fields references handle '…'; not yet in captured map`. The cross-recipe reference pre-seed (`crossRecipeRefs`, which lets the executor resolve refs to items produced by other recipes by reading them from the tenant) was built from the post-`--handles` IR subset instead of the full compiled set. So a recipe referencing an item that lands in a different batch — e.g. a component's `Items`/`Articles`/`Features` source restriction pointing at its datasource-item template (`link-list-item@1`, `article-card@1`, …) — had no pre-seed entry and aborted the batch. `crossRecipeRefs` is now built from the full compiled set before `--handles`/`--aggregates-only` scoping, matching the documented contract.
