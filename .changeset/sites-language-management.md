---
"@sitecoreai-labs/sitecoreai-cli": patch
---

feat(sites): environment language management (Sites API) + recipe provisioning

Languages are environment-scoped, so a language added here is available to every
site in the environment AND surfaces to higher-level consumers that read the
environment's languages — notably the Sitecore AI brand-kit Glossary's org
locales. (There is no separate "org language" API; adding an environment
language is what makes a locale available org-wide.)

- **SDK** (`@/sites`): add `listSupportedLanguages`, `updateLanguage`, and
  `removeLanguage` alongside the existing `listLanguages` / `addLanguage` —
  full CRUD on the Sites API `/api/v1/languages` resource.
- **CLI**: new `scai provision sites language` group — `list`,
  `list-supported`, `add --code <iso>`, and `rm --code <iso>` (env-scoped,
  `--json`/`--quiet`; `rm` is gated by `--apply`).
- **Recipe push**: a site recipe's primary `language` plus any additional
  `languages` are now ensured on the environment (idempotently) **before**
  `createSite`, closing the gap where site creation failed on a language that
  hadn't been added yet.
