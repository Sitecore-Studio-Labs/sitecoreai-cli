---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Provisioned languages now land on the SITE's language list, not just the environment. Registering a locale environment-wide doesn't surface it on a site — the site keeps its own `supportedLanguages`, and Pages only offers locales on that list. The recipe push now keeps both in step: `createSite` passes the recipe's full declared language list on the new-site input, and the existing-site branch of `CreateSiteFromTemplate` diffs the declared languages against the site's `Site.languages` and PATCHes `supportedLanguages` with the union. Both paths gate site-level codes to languages the environment actually registered after the ensure, so bare base admission codes the supported-locale catalog gate skips (e.g. `de` for a declared `de-DE`) stay off the site list too. The site PATCH is additive only — a site's language list is never shrunk.
