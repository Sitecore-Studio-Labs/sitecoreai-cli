---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`campaign sync push`: add `--conflict-policy` flag (mirrors brief sync).

`scai ops campaign sync push` accepts `--conflict-policy <error | recipe-wins | cms-wins>` and threads it into `ctx.pushConflictPolicy`, identical to `scai ops brief sync push --conflict-policy` (shipped earlier).

Closes a gap that forced the orchestrator to swallow the field — `campaignKind.plan()` defaults `pushConflictPolicy` to `"error"`, which blocks every cms-edit / conflict cell with `POLICY_DENIED`. Hand-driven CLI use can now pick `"cms-wins"` to preserve Sitecore AI edits or `"recipe-wins"` to clobber; automation flows (e.g. the showcase-orchestrater's `recipe_sync` campaign mode) forward whatever the caller's plan specifies so a story autosync doesn't hard-fail on the first tenant-side edit.

No `RecipeKind` interface change; behaviour identical to the brief flag.
