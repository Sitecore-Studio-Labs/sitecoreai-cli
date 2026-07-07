---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Batch-driver support for parallel recipe pushes:

- `recipe list --json` now emits the recipe dependency graph — per recipe
  `rank` (coarse apply tier), `dependsOn` (in-set cross-recipe handle
  references, the same edges the sequential apply order topo-sorts by), and
  `languages` (authored locale inventory, verbatim codes) — plus the
  set-wide `languages` union and the synthetic aggregate handle inventory
  (`aggregates.pre` / `aggregates.post`). A driver can schedule independent
  same-rank recipes as parallel waves, scope localize passes to exactly the
  authored languages, and knows which aggregate handles its
  `--handles`-scoped pushes drop.
- `recipe push --aggregates-only` applies ONLY the synthetic cross-recipe
  aggregate IRs (`__available-renderings__`, shared Data Folder insert
  options, placeholder settings, …) — the complement of `--handles` for
  batch drivers. Mutually exclusive with `--handles`.
- The path auto-provisioning walker now tolerates losing a concurrent
  folder-create race (two parallel pushes probe-missing the same segment):
  the loser resolves the winner's folder via parent-children lookup instead
  of aborting the recipe — same idempotent-create fallback `createItem`
  already had.
