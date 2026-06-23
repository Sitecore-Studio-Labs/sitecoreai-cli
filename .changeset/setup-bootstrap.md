---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(setup): `setup bootstrap` command + `recipe compile` resolves the full set

Adds `scai setup bootstrap [env]` — one guided, idempotent flow from a configured
env profile to a pushable recipe set: workspace-policy grants (enroll + permit
minting + raise ceiling to `destructive`, consent-gated), device login, CM
automation client, SXA site picker, and an optional recipe push. Collapses the
five commands operators otherwise run (and discover one-error-at-a-time) into one.

Also: `scai provision recipe compile` now compiles the whole recipe set via
`compileRecipeSet` (was per-recipe). Cross-recipe references (`section`, treelist
sources, enum handles) resolve offline, and the cross-recipe aggregates (available
renderings, placeholder settings, templates mapping) are emitted to `.scai/` — so
`compile` is a faithful no-tenant validation of what `push` applies. A broken
`section` ref now fails at compile time instead of only at push.
