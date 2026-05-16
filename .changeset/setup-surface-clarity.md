---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai setup` is less confusing — login and init flags.**

- **`--non-interactive` removed from `setup login` and `setup login
ai-skills`.** It was bulk-inherited from the shared verbosity options
  but never made sense there: interactive login is a browser device
  flow that cannot run headless, and the client-credentials path is
  already non-interactive once `--client-id`/`--client-secret` are
  given. `setup login --help` now explains the two auth modes
  (interactive vs. client credentials) directly.

- **`setup init`: Deploy-API flags renamed to stop colliding with the
  profile flags.** `--organization` → `--deploy-organization` and
  `--environment` → `--deploy-environment`, so they no longer read as
  near-duplicates of `--organization-id` and `--environment-name` (two
  genuinely different things). The old spellings keep working as hidden
  aliases — existing scripts are unaffected. `setup init --help` now
  groups the flags (identify-the-environment / authentication /
  identifiers) instead of listing 19 flags flat.
