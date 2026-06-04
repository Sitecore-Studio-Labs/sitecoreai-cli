---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`campaign sync`: stamp `handle:<x>` identity labels on task updates, not just creates.

Two related fixes so a task that gains identity in a re-push actually carries it to the tenant:

1. **Diff (`tasksEqual`)**: treats a desired task as "different from current" when the recipe carries a `handle` AND the current task's labels lack `handle:<handle>`. Without this, a recipe that added identity via the orchestrator's lazy backfill (or a hand-edit) would diff as noop and stop short of writing — the tenant would stay unidentified, so the next rename on Sitecore AI would create a duplicate instead of matching back.
2. **Apply (UPDATE branch)**: writes `[...task.labels, handle:<handle>]` to the wire, mirroring what the CREATE branch already does. The UPDATE path used to push the raw operator-authored labels directly, dropping the recipe's identity on every PUT.

Net effect: a story whose tasks were authored before per-row handle minting (LLM-generated or seeded campaigns) can re-establish wire identity via a no-op push. Subsequent tenant-side renames then round-trip cleanly instead of surfacing as duplicates.

No schema changes; deliverables are unaffected (no UPDATE path on that resource — separate follow-up).
