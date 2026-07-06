---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Provision a `SiteRecipe`'s declared languages on the environment before
compile, on every push — not only when the site is created.

`SiteRecipe.languages` is documented as "recipe push adds missing ones", but
the only place scai registered them was the `createSite` mutation, which
never runs when the site already exists. Meanwhile the recipe compiler
filters each recipe's authored `__Standard Values` locale-map defaults and
dictionary translations down to the environment's _registered_ languages
(`listLanguages`). The net effect on a re-push of an existing site: a
declared-but-unregistered locale (e.g. `ar-SA`) was dropped from the emitted
IR entirely, so the localized Standard Values and dictionary phrases never
installed — even though the recipe authored them.

`recipe push` now registers a `SiteRecipe`'s `language` + `languages` via the
Sites API ahead of resolving the environment's language list, so the compiler
sees the freshly-added locales and emits their versions. Idempotent
(`addLanguage` 409s are success) and best-effort (an auth/network failure is
swallowed so the push still proceeds). No site (re)creation required.
