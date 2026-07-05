---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Dictionary recipes now install into the deploy's target site by default.

`DictionaryRecipe.site` is now **optional**. When omitted (the common case),
the dictionary lands under the deploy's target site
(`/sitecore/content/<siteCollection>/<site>`, resolved from the active env
profile) — the same single-site location every page and enum install into.
No in-set `SiteRecipe` is required.

Set `site` only to host the phrases on a different in-set site than the deploy
target (e.g. a shared-site phrase library), in which case the handle must
resolve to a `SiteRecipe` in the same push, as before.

This removes the previous requirement that a host `SiteRecipe` (e.g.
`showcase-shared@1`) be present in the recipe set for a single-site install,
which failed `recipe-push` with `INPUT_INVALID`.
