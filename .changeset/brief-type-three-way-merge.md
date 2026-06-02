---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`brief-type`: three-way merge with baseline classification.

`briefTypeKind` is upgraded from a straight two-way diff to baseline-aware
three-way merge, matching `briefInstanceKind` and `brandKitKind`. The
`--conflict-policy` flag (`error` | `recipe-wins` | `cms-wins`) on
`scai ops brief sync push --kind brief-type` is now honoured — it was a
no-op before because the kind never consulted `ctx.baselineStorage`.

**`src/brief/recipe/baseline.ts` (new export):** `BriefTypeBaselinePayload`
(flat cell map: scalars `name`/`label`/`description`/`icon`/`iconColor` +
`fields.<codename>`), `hashBriefTypeCells`, `captureBriefTypeBaselinePayload`,
`classifyBriefTypeCells` (per-cell `first-push` / `recipe-change` /
`cms-edit` / `conflict` against the previous baseline),
`mergeBriefTypeByPolicy` (policy-aware resolution; recipe owns the
field-graph — tenant-only fields are not pulled in, matching brand-kit
semantics).

**`briefTypeKind.plan()`**: loads baseline via `ctx.baselineStorage`,
classifies each cell, merges per `ctx.pushConflictPolicy`, annotates
each `RecipeChange.meta` with `classification` +
`perFieldClassification`, surfaces a `policyError` on the lead
`stage: "type"` change when `error` policy + conflicts.

**`briefTypeKind.apply()`**: refuses with `POLICY_DENIED` when the plan
carries an unresolved `policyError`. Writes a fresh baseline reflecting
the merged (post-policy) state after a successful push. Synthesizes a
noop `stage: "type"` change when the diff would otherwise emit none, so
a `cms-wins` full-resolution still refreshes the baseline (otherwise
the same drift re-classifies as `cms-edit` on the next push —
`briefInstanceKind` has this same gap, flagged for a future port-back).

No `RecipeKind` interface change. The behaviour change is opt-in via
`ctx.baselineStorage` — callers without a baseline store get the same
two-way diff behaviour they had before.

43 new unit tests across `tests/unit/brief/recipe/baseline.test.ts` and
`tests/unit/brief/recipe/kind.test.ts` cover hashing, the four
classifications, all three policies, field add/remove, field-graph
ownership, and degradation when `ctx.baselineStorage` is absent.
