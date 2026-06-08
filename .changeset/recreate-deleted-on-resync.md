---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recreate a deleted-on-tenant entity on explicit resync instead of blocking.

`resolveMissingCurrentPlan` previously threw `POLICY_DENIED` under the `error` policy when the whole entity was gone on the tenant, forcing a "Use my changes" resolve click. A missing entity isn't a field-level conflict — an explicit resync means "put it back". It now recreates under every policy except `cms-wins`; `cms-wins` (background autosave) still honors the deletion (no-op) so an unrelated edit never silently resurrects a deliberately-deleted entity.
