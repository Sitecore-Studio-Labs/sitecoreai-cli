---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`--provision-languages` now also appends the provisioned scope to the profile's target SITE language list (`supportedLanguages` — the property Pages offers locales from), not just the environment registry. A pages-only push carries no Site recipe, so the executor's CreateSiteFromTemplate language ensure — which handles the site append for site pushes — never ran: an install into an existing site registered the brand's languages org-wide but Pages never offered them on the site. The append is additive-only, gated to codes the environment ensure actually registered, and skipped when the profile has no `site` or the site doesn't exist yet (a fresh-site install's `createSite` declares its languages itself).
