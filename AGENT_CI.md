# Agent/CI Usage Guide

This guide focuses on non-TTY and automation use cases.

## Non-interactive quickstart

Recommended flags:

- `--non-interactive` to disable prompts (auto-detected when no TTY is available).
- `--json` for machine-readable output.
- `--config <path>` when running outside the project root.
- `--environment-name <name>` to target a specific env profile.

Common environment variables:

- `SITECOREAI_CLIENT_ID`
- `SITECOREAI_CLIENT_SECRET`
- `SITECOREAI_DEPLOY_TOKEN`
- `SITECOREAI_ENV_<NAME>_ALLOW_WRITE=true`
- `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`

Example (serialization push in CI):

```sh
scai serialization push \
  --environment-name ci \
  --non-interactive \
  --json \
  --allow-write
```

Example (deploy list in CI):

```sh
scai deploy environments list \
  --project "<project-id>" \
  --environment-name ci \
  --non-interactive \
  --json
```

## Authentication flows

| Flow               | Required inputs                                                              | Notes             |
| ------------------ | ---------------------------------------------------------------------------- | ----------------- |
| Deploy token       | `--deploy-token` or `SITECOREAI_DEPLOY_TOKEN`                                | Works in non-TTY. |
| Client credentials | `--use-client-credentials` + `--client-id` + `--client-secret` (or env vars) | Works in non-TTY. |
| Device login       | TTY + browser access                                                         | Interactive only. |

## CM vs Editing Host

- **CM-only environment:** `scai deploy environments create --cm-only`
- **Editing host:** `scai deploy editing-host create --cm-environment-id <id> --name <name>`

## Build config expectations (CM-only)

CM-only deployments expect build configuration in `xmcloud.build.json`, including:

- `buildTargets` (e.g., authoring build target)
- `authoring` settings (authoring path and related values)

## Flag mapping (common sources of confusion)

- `--environment-name` selects a config profile (aliases: `-n`, `--env`, `--env-name`).
- Deploy commands use `--project` for project name/ID.
- Deploy environment operations use `--name` for environment name and `--id` for environment ID.

## Deployment watch

Use `--timeout <seconds>` to stop watch loops in CI:

```sh
scai deploy deployments watch --id <deployment-id> --timeout 3600
```

## Dry-run for deploy

Use `--what-if` on deploy commands to print the resolved API call and payload without executing it.

## Exit codes

- `2`: configuration or input errors
- `3`: authentication required
- `4`: network errors
- `5`: environment not found
- `6`: deploy failures
