---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe push: the CreateItem marker-rename fallback no longer rebinds onto a stale sibling whose live template differs from the op's expected template. A recipe that swaps the component behind a slot (e.g. a partial design's header moving from `main-nav@1` to `header@1`) renames its scoped datasource AND changes its datasource template — the stale item from the previous push still carries the recipe's `Scai Handle` marker, so the fallback used to adopt it as "renamed", leave its old template in place, and abort the recipe on the first SetField for a new-template-only field ("Authoring GraphQL errors: Cannot find a field with the name Logo."). A template mismatch now disqualifies the rebind candidate and the planner creates the new item fresh; the stale sibling is left in place. The guard only engages when the expected template resolves to a live itemId (workspace-seeded or captured this push) — otherwise behavior is unchanged.
