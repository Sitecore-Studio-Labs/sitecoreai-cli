---
name: environment-setup
description: Configure authentication for environments (deploy token or client credentials). Use when the user asks about login, deploy tokens, or environment auth setup.
---

# Environment Setup

## Choose auth method

- **Deploy API**: requires `deployToken` in the environment config.
- **Serialization**: requires `authority` plus OAuth credentials.

## Common flows

1. Device login (interactive):
   - `npm run dev -- login --environment-name <name>`
2. Client credentials (non-interactive):
   - Set `SITECOREAI_CLIENT_ID` and `SITECOREAI_CLIENT_SECRET`
   - Add `--use-client-credentials` when needed

## Checklist

- `environment-name` exists in `sitecoreai.cli.json`.
- `deployToken` present for deploy commands.
- `authority`, `clientId`, `clientSecret` set for serialization auth.
