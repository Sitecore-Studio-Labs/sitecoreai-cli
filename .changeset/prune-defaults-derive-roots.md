---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): derive recipeRoots in prune-defaults from site + siteCollection

`recipe prune-defaults` read the content-side roots (`headlessVariantsRoot`,
`availableRenderingsRoot`, `contentItemsRoot`, `presentationStylesRoot`)
straight off the env profile — unlike `push`/`pull`, which derive them via
`withDerivedRecipeRoots`. A profile that configures only `site` +
`siteCollection` (e.g. the orchestrator's ephemeral CLI config, which no
longer writes explicit `*Root` fields) therefore failed with `INPUT_INVALID`
"root path(s) not configured" even though push/pull resolved them fine.
prune-defaults now derives the same way.
