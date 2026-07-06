---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Align dictionary translations to the target environment's languages.

`recipe push` now resolves the environment's languages from the Sites API
(`listLanguages` — the same language source the brand-kit Glossary reads) and
passes them to the dictionary compiler as `context.availableLanguages`.
`compileDictionaryRecipe` filters each phrase's translation locales to that
set: a dictionary installs exactly the brand's languages and never emits an
`AddItemVersion` for a locale the tenant doesn't have.

- One shared dictionary can author every supported translation; each install
  materialises only the locales its environment has (matched case-insensitively
  on both `iso` and `regionalIsoCode`, e.g. `pt` / `pt-BR`). Authored locales
  the environment lacks are skipped; environment locales the dictionary doesn't
  author fall back to the primary via SXA dictionary resolution.
- The primary locale is always emitted (the default-language fallback).
- Best-effort: the Sites API call runs only when the set contains a
  `dictionary` recipe, and an auth/network failure falls back to emitting every
  authored translation (the previous behaviour) rather than aborting the push.
- Standalone `compileDictionaryRecipe` callers that don't set
  `availableLanguages` are unaffected.
