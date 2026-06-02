---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: bidirectional sync — three-way merge between recipes, tenant, and a per-(env, recipe) baseline

`scai recipe push` and `scai recipe pull` are now joined by a
baseline-backed three-way merge that detects "the author edited this
in the CMS since my last push" (push side) and "my local recipe has
changes the tenant hasn't seen" (pull side). Before 0.3, push silently
clobbered tenant-side author edits and pull was a snapshot-only dump
that ignored your local recipes.

**New on `scai provision recipe push`:**

- `--conflict-policy=error|recipe-wins|cms-wins` (default `error`) —
  block on any cms-edit / conflict, or pick a side. `error` exits
  non-zero with per-(recipe, op) details so CI fails loud instead of
  silently overwriting.
- `--no-baseline` — opt out of baseline load + post-apply write
  (legacy two-way diff behaviour).
- Successful pushes write a baseline file to
  `<configDir>/.scai/baseline/<env>/<slug(handle)>.baseline.json`
  (atomic temp + rename; SHA-256 hashes per field, not values).

**New `scai provision recipe pull` commands + flags:**

- `pull` is the new reverse command — read tenant state to disk as
  `.recipe.json` files. Snapshot mode (default) dumps to
  `--output ./pulled-recipes`; never overwrites authored `.recipe.ts`
  source.
- `--against <recipes-dir>` enables merge-detection mode. Pull
  classifies each recipe as `in-sync` / `disk-ahead` / `tenant-edited`
  / `conflict` / `disk-only` / `tenant-only`, surfaces per-field
  statuses, and blocks under default `--conflict-policy=error` if
  anything needs operator attention.
- `--conflict-policy=error|disk-wins|tenant-wins` — direction-inverted
  from push. `tenant-wins` does **per-field merge** for ContentItem
  and Page recipes (preserves disk-ahead fields, adopts tenant
  elsewhere); `disk-wins` keeps local recipes authoritative.
- `--write-plan <path>` emits a hand-editable JSON plan with one
  entry per per-recipe per-field classification + the default winner.
  Operator flips per-field `winner` between `"disk"` and `"tenant"`,
  then re-runs with `--apply-plan <path>` to commit. Apply-plan
  verifies the plan still matches the current tenant + disk state
  (refuses to apply stale plans against a moved world).
- `--no-baseline` mirrors push.
- `--dry-run` classifies + reports without writing any files.

**Reverse-projection (`readCurrent`) coverage:** the projection now
covers 10 recipe kinds with full multi-language + multi-version
fidelity for `ContentItem` and `Page`. Layout XML is parsed +
canonicalised before hashing so push (canonical XML) and tenant
read-back (SXA delta XML) round-trip cleanly.

**Public API additions** (importable from `@sitecoreai-labs/sitecoreai-cli/recipe`):

- `BaselineStorage` interface + `FileBaselineStorage` class (default
  impl). Pass a custom storage to push / pull via
  `RecipeTenantOptions.baselineStorage` for orchestrator-hosted /
  in-memory backends.
- `Baseline`, `BaselineFieldEntry`, `BaselineIndex` types +
  `BaselineSchema`, `BaselineFieldEntrySchema` Zod schemas.
- `loadBaseline`, `writeBaseline`, `baselineFilePath`,
  `indexBaseline`, `hashFieldValue`, `hashFieldValueForBaseline`,
  `isLayoutFieldId`, `canonicaliseLayoutXml`.
- `MergePlan`, `MergePlanRecipe`, `MergePlanField` types +
  `MergePlanSchema`, `MergePlanRecipeSchema`, `MergePlanFieldSchema`
  Zod schemas.

**Behaviour changes operators will see:**

- Successful `recipe push` now writes baseline files (one per
  recipe, per env) to `<configDir>/.scai/baseline/<env>/`. Add
  to `.gitignore` if you don't want them checked in; they regenerate
  on each push.
- Default `recipe push` policy is `error` — out-of-band Sitecore UI
  edits will block re-pushes until the operator picks
  `--conflict-policy=recipe-wins` or `=cms-wins`. To restore the
  pre-0.3 silent-clobber behaviour, pass `--conflict-policy=recipe-wins`
  or `--no-baseline`.
- `recipe pull` is new — no behaviour change for existing flows that
  don't run it.

**Security:** the `Scai Handle` tenant marker field is now validated
against `HANDLE_PATTERN` before being trusted in file-path composition
(audit-flagged path-traversal hardening). Malformed markers
(`'../../tmp/pwn@1'`, paths with separators, etc.) fall back to
synthesising the handle from the Sitecore item name; defensive
`assertWithinDir` guards added to `writeRecipeJson` +
`FileBaselineStorage` as belt-and-braces.

**Performance:** baseline loads run in parallel (was sequential);
layout XML parses are deduped on the planner's hot path (4× → 2×
parses per drift); template per-field rollup is O(1) per field
(was O(T × S) via prefix-walk).

Full operator walkthrough: [`docs/bidirectional-sync.md`](https://github.com/Sitecore-Studio-Labs/sitecoreai-cli/blob/main/docs/bidirectional-sync.md).
Architecture rationale: [`docs/recipe-sync-architecture.md`](https://github.com/Sitecore-Studio-Labs/sitecoreai-cli/blob/main/docs/recipe-sync-architecture.md).
