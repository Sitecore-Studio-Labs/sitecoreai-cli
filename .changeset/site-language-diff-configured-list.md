---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Site language provisioning now diffs and patches the site's CONFIGURED language list (`Site.supportedLanguages` — the property Pages offers locales from), not `Site.languages` ("languages in use by the site", which is content-derived: a localize pass that already wrote `de-DE` versions made the locale look present while Pages still didn't offer it). The executor also re-reads the site via `GET /api/v1/sites/{siteId}` right before the PATCH so the merge base is the authoritative detail view, and the existing-site language ensure now runs even when the SiteTemplate refKey isn't captured — an existing site doesn't need its template, and the old template-first early skip silently swallowed language provisioning for such steps.
