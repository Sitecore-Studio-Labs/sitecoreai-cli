---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Install pipelines can now provision a brand's languages onto the environment instead of silently narrowing to what's already registered.

- `recipe push --provision-languages` registers the `--languages` scope on the environment before localize targets resolve (idempotent, additive; newly-added languages get their fallback chain wired regional → base → en). Without the flag, behavior is unchanged: scoped locales the environment lacks are dropped, not created. Requires `--languages`; a missing Sites API credential fails loud instead of silently skipping.
- A `CreateSiteFromTemplate` push against an **existing** site now diffs the recipe's declared languages (primary + `languages[]`) against the environment and registers any missing ones — previously the ensure only ran on the create path, so a language added to the brand after the site's first install never reached the environment.
