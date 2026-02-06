---
name: config-bootstrap
description: Bootstrap and validate sitecoreai.cli.json configuration. Use when creating new configs, adding environments, or fixing config validation errors.
---

# Config Bootstrap

## Quick start

1. Initialize a config:
   - `npm run dev -- init --environment-name <name> --cm <url>`
   - Use `--skip-deploy-lookup` if Deploy API access is limited.
2. Validate the config:
   - `npm run dev -- config validate`

## Checklist

- Ensure `sitecoreai.cli.json` is at the project root (or pass `--config`).
- Confirm `defaultEnvProfile` points to a valid environment.
- Populate `authority`, `clientId`, `clientSecret` when using client credentials.
- Set `allowWrite: true` in an environment when pushes are intended.
- In CI, set `SITECOREAI_AUTO_WIZARD=0` to avoid prompts.

## Output expectations

- On success: normal output or JSON if `--json` is used.
- On failure: actionable error + hint; use `--trace` for extra context.
