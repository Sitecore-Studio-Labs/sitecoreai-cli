---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**New: `scai sync` — the cross-domain recipe aggregate.**

`brand sync` and `ops brief sync` each pull/diff/push one instance at a
time. `scai sync` fans them out: it enumerates _every_ brand kit and
_every_ brief type on the environment and operates on them all.

- `scai sync pull` — capture every kit + type into a workspace
  (`.scai/sync/<kind>/<id>.yaml` by default; `--dir` to override).
- `scai sync status` — diff every workspace recipe against the env.
- `scai sync push` — converge them all (dry-run unless `--allow-write`).

A domain that isn't configured for the environment (missing
credential) is skipped with a warning, not fatal — the others still
run.

The recipe/sync engine's `RecipeKind` contract gained an optional
`list(ctx)` method; `brand-kit` and `brief-type` implement it. Kinds
without `list` (file-authored component/page/site recipes) are simply
not part of the aggregate and stay with `provision recipe`.
