---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe push no longer auto-provisions a SiteRecipe's declared languages, and localization now scopes to the languages ALREADY installed on the environment. Previously `recipe push` registered every language a SiteRecipe declared (`addLanguage`) before resolving the localize set, so a recipe declaring many locales would create them on the CM and then fan base-language `__Standard Values` defaults (e.g. `ar`) out across every registered regional variant — turning a 5-locale environment into a 25-locale localize pass that overloaded the Authoring API. The localize pass now targets exactly what the environment supports; a declared-but-uninstalled locale's content is dropped rather than silently created. Provisioning a genuinely new language is the operator's step (or happens via `createSite` for a fresh site, which is unchanged).
