---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `brand sync push` aborting on phantom three-way-merge conflicts.

`hashBrandCells` emitted `kit.description` and `kit.industry` cells, but those are Sitecore-owned kit metadata — written once at `createBrandKit` time and never by the converge loop. `readCurrent` always populates them from the live kit, while a pushed recipe omits them (the registry renders them read-only). So `desired` (undefined) perpetually diverged from `current` (live value): the planner classified both as a `cms-edit` on every push, and under `--conflict-policy error` it refused before any writes — breaking push entirely for otherwise-unchanged content. `cms-wins`/`recipe-wins` masked it; `error` (the registry's manual "Sync to Sitecore AI" default) exposed it. Pull has no merge gate, so pull kept working while push failed.

Omit `description`/`industry` from `hashBrandCells`, exactly as `documents` is omitted — they are not a write-back surface, so they have no place in the diff. Adds a regression test asserting an `error`-policy push is not blocked when only Sitecore-owned metadata differs.
