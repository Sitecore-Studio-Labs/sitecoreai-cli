---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Language provisioning registers only supported locales. `ensureEnvironmentLanguages` (behind `--provision-languages`, the createSite pre-ensure, and the existing-site ensure) now gates `addLanguage` on the environment's supported-language catalog (`GET /api/v1/languages/supported`): a brand declaring `de-DE` registers `de-DE`, while the bare base admission code `de` — which the localize fan-out legitimately scopes a push to for base-fallback content — is skipped instead of aborting the push with `SITES_API_FAILED: The provided language 'de' with region code '' is not supported`. A regional catalog entry does not make its bare base registrable; when the catalog can't be read, a per-code "not supported" rejection degrades to a skip rather than an abort. Genuine Sites API failures still throw.
