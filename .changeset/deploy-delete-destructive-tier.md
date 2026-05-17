---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Deploy environment / project deletion is now destructive-tier gated.**

`scai provision deploy environment delete` and `… project delete` previously
relied only on a `confirmDestructive` prompt (skippable with `--force`).
They now also run through the workspace-policy `destructive` tier — an
irreversible deletion is refused for `m2m` / `mcp` callers and for a `ci`
caller without `ciWrites`, and honours the environment ceiling and step-up
window. A no-op in unmanaged mode.

This closes the Phase 3 follow-up that had left these two runners untiered.
The remaining guardrails follow-up — OS-level confinement of the recipe
sandbox child — is documented in `docs/recipe-sandbox.md`: it is blocked on
a sandbox redesign, because tsx requires `--allow-worker`, which Node itself
warns invalidates the permission model.
