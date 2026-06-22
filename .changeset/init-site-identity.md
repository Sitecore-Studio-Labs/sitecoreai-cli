---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(setup): capture SXA site identity in `setup init` so recipeRoots derive automatically

`scai setup init` now resolves and persists `site` + `siteCollection` on the env
profile (new `--site` / `--site-collection` flags; the wizard prompts, defaulting
the site to the env name). When `siteCollection` is omitted it is discovered from
the environment's sites (best-effort — a miss falls back to a prompt or warning, so
init never blocks). With both values set, `scai provision recipe` derives the full
recipeRoots set, so a fresh profile works without hand-written tree paths.

Also: `recipe compile` now applies `withDerivedRecipeRoots` up front (matching
`push`), so the optional roots (headless variants, enumerations, placeholder
settings) derive from `site` + `siteCollection` too — previously only
templates/renderings did, so compiling a variant-bearing recipe still demanded an
explicit `headlessVariantsRoot`.
