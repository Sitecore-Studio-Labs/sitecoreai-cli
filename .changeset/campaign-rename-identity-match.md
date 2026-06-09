---
"@sitecoreai-labs/sitecoreai-cli": patch
---

campaign: match deliverables/tasks by stable identity, not just name

Renaming a deliverable or task in a campaign recipe created a duplicate on Sitecore instead of updating in place — the diff/merge/apply all keyed on the display name, so a rename read as delete-old + add-new. Now they match on `sitecoreId` → `handle` → `name`: the merge stops stripping identity, pull surfaces server UUIDs as `sitecoreId` so the id round-trips, apply resolves targets by id first, and every deliverable/task emits an identity (handle-less and unchanged included) carrying `parentName` so callers can stamp the id back even when a parent has no handle.
