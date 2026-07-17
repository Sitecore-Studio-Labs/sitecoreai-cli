---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): own the shared enumeration templates via a stable `__enumeration-templates__` aggregate

The per-site `Enumerations Folder` / `Enumeration` / `Enumeration Value` templates and their `__Standard Values` were emitted by whichever enumeration recipe compiled **first** in a set, which stamped that recipe's handle as the tenant OWNERSHIP marker on the shared `__Standard Values` items. That "first enum" identity is not stable: it shifts as the recipe set / topological order changes across rebuilds, or when batched (`--handles`-scoped) pushes split enum recipes across separate compiles. A later install then tried to reconcile a `__Standard Values` owned by a different recipe and aborted with `Name collision: item '__Standard Values' … is owned by recipe 'X', not 'Y'` (exit 6).

`compileRecipeSet` now emits the shared template trio + inner Value fields + `__Standard Values` + Insert Options exactly once, under the stable synthetic handle `__enumeration-templates__` (a FRONT aggregate, like `__shared-data-folders__`), so the ownership marker is deterministic across every install regardless of recipe order or batching. The per-recipe pass resolves the template refKeys only. Single-recipe compiles (no set) still emit the templates inline so the IR stays self-contained. The new handle is added to `FRONT_AGGREGATE_HANDLES` so `recipe list --json` advertises it to batch drivers.
