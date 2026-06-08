---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Repair non-canonical `richArray` brand-kit fields on sync (Tone of Voice / Image Style).

The earlier fix stopped scai from writing scenario entries without `tags`/`restrictions`, but only on an actual write — kits written by an older scai still hold the broken `[{name}]` shape, and since the recipe value equals the broken live value the field diffs as a no-op, so a normal re-sync never rewrites it and the Sitecore section render keeps crashing on `entry.tags.map(undefined)`. `plan` now detects any live `richArray` field whose entries lack `tags`/`restrictions` and force-emits an `update`, so the next sync rewrites the canonical shape (idempotent once repaired). Fixes broken Tone of Voice / Image Style pages on existing brands via a normal re-sync.
