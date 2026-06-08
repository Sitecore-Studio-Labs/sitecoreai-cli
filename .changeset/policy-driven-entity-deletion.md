---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Resolve whole-entity deletion by conflict policy, consistently across all kinds.

Every kind's `plan()` hardcoded `if (current === null) return diff(desired, null)` — an unconditional recreate when the entity is gone on the tenant, ignoring both the baseline and the push conflict policy. So a kit/brief/campaign deleted on Sitecore silently reappeared on the next background sync, and the behaviour diverged from how field-level cms-edits are handled (and between brand and stories).

A missing entity with a stored baseline is the extreme case of a cms-edit (the tenant changed it from exists→gone), so it's now resolved by the same policy via one shared helper `resolveMissingCurrentPlan`: no baseline → first-push recreate; `recipe-wins` → recreate; `cms-wins` → honor the deletion (no-op, don't resurrect); `error` → `POLICY_DENIED` into the same resolve flow as a field conflict ("Use my changes" → recipe-wins recreate, "Use Sitecore's changes" → cms-wins accept). Wired into brand-kit, brief-type, brief, and campaign so all four behave identically. No UI changes needed.
