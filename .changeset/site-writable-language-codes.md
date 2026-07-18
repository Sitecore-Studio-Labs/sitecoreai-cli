---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `SITES_API_FAILED` ("The provided language 'de' with region code '' is not supported") when a localize/provisioning scope carries a bare base language. `ensureEnvironmentLanguages` returned an iso-inclusive set — a registered `de-DE` puts BOTH `de-DE` and a bare `de` in it — and every consumer uses that return only to gate SITE-level language writes (an existing site's `supportedLanguages` PATCH and a fresh site's declared `languages`). Bases like `de` are valid localize fallback targets but are not registrable site languages, so writing one 400'd the whole push. The return is now the environment's site-writable set — regional identities only (`de-DE`, `de-CH`, `en`), never a bare base derived from a regional's iso — built from the pre-ensure regionals plus the codes just added (no post-ensure re-list, so no propagation-lag flake). Base-authored fallback content still localizes into its regionals via the existing fallback chain.
