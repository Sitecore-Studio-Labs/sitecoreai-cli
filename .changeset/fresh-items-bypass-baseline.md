---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Items created during the current push run bypass three-way baseline
classification for their follow-up update ops.

A brand-new item cannot carry CMS edits, but a stale baseline (same
deterministic refKey, previous item at an old path — exactly what a
layout relocation like the Components → Pages bucket move produces)
made the fresh item's server-default field values classify as
`cms-edit`/`conflict`, blocking the write under the default conflict
policy and shipping items with default values. The executor now tracks
every CreateItem applied in the run (shared across the push's IRs) and
the planner skips baseline lookup for update ops targeting them.
