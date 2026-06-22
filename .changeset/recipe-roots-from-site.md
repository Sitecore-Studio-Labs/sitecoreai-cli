---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(recipe): derive recipeRoots from `site` (+ auto-resolved collection)

Recipe authoring no longer requires hand-writing the ~13 SXA Headless
`recipeRoots` paths. Set `site` (and optionally `siteCollection`) on an env
profile and scai derives the full set from the standard SXA tree layout:

- New `site` / `siteCollection` fields on env profiles (`sitecoreai.cli.json`).
- `recipe compile|plan|diff|push|pull` backfill any unset `*Root` from the
  derivation; explicit `recipeRoots` / `*Root` config and `--*-root` CLI flags
  still override per root (`flag > explicit > derived`).
- When `site` is set but `siteCollection` is not, scai resolves the collection
  by discovering the environment's sites and matching by name; a clear
  `INPUT_INVALID` points at the explicit-`siteCollection` escape hatch on
  failure. No network for explicit-roots / collection-set configs.
- New `scai provision recipe roots [--site <name>] [--site-collection <name>]`
  command prints the derived `recipeRoots` block (JSON via `--json`) to paste
  into `sitecoreai.cli.json` or to inspect what `recipe push` will use.

GUID seeding is unchanged — the derivation only affects content-tree parent
paths, not item ids, so existing pushes stay idempotent.
