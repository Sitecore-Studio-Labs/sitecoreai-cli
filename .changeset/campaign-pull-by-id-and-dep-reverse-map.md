---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`campaign sync pull`: add `--sitecore-id` for id-first lookup, and reverse-map task `dependencies` back to handles.

Two coordinated fixes so a campaign round-trip stays lossless when SAI-side edits land via the registry's auto-pull-on-load.

1. **`--sitecore-id <uuid>` on `scai ops campaign sync pull`** — when present, `campaignKind.readCurrent` resolves the Orchestrate project by id via `getProject` directly and skips the paged display-name search. Falls back to the legacy name search if the id resolves to nothing (stale UUID survives without permanently blocking pull). Mirrors the push side, which already used `recipe.sitecoreId` as `KindRef.tenantId`. Without this, any rename on either the registry or SAI side surfaced as "Campaign 'X' not found" and the orchestrator's not-found heuristic silently treated the pull as "no-tenant-state" — appearing as if pull did nothing at all.

2. **Reverse-map task `dependencies` UUID triples → handles on pull.** `toRecipeTask` previously hardcoded `dependencies: []` because the Orchestrate wire stores deps as `{project_id, project_deliverable_id, task_id}` triples and the recipe shape carries them as handle arrays. The orchestrator's auto-pull then wrote that empty list back to the registry's recipe, wiping every LLM-generated dependency on the first push-pull cycle; the next edit re-pushed empty deps and SAI lost them too. `readCurrent` now builds a `taskId → handle` index from `handle:<x>` labels and projects each dep entry through it; tasks without a handle label are silently dropped from the dep list (can't be addressed by handle on the recipe side).

No `RecipeKind` interface change. New tests cover `ref.tenantId` direct-load, stale-id fallback to name search, and dep reverse-mapping including the legacy-task drop case.
