---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Environment-language fallback wiring + shared page layout.

**Fallback languages**: every environment language provisioned by scai now
gets its `fallbackLanguageIso` wired to match the base-locale model —
a regional code falls back to its base language when the environment
carries it (`ar-AE` → `ar`), otherwise to `en`; base languages fall back
to `en`. Applied by `provision sites language add` and by the recipe
push's `ensureEnvironmentLanguages` (which also repairs pre-existing
languages missing a fallback — operator-configured fallbacks are never
overwritten). Best-effort: a failed fallback PATCH never fails the add
or the push. New exported helper: `fallbackLanguageIsoFor`;
`SitesApiClient` gains `updateLanguage`.

**Shared page layout**: `PageRecipe.layoutScope: "shared"` writes the
item-level layout ONCE to the page's `__Renderings` (Sitecore's Shared
Layout) instead of copying it into every language version's
`__Final Renderings` — all languages render the same layout, content
still localizes via datasource versions and dictionary, and Pages author
edits land per-version on top. Default (`"versioned"`) is unchanged.
Story mode rejects `"shared"` (per-version layouts are inherently
versioned).
