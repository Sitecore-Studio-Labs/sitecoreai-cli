---
name: deploy-ops
description: Run Deploy API commands for projects, environments, and deployments. Use when working with deploy workflows or managing deploy resources.
---

# Deploy Ops

## Core commands

- Organizations: `npm run dev -- deploy organizations get`
- Projects: `npm run dev -- deploy projects list`
- Environments: `npm run dev -- deploy environments list --project <id>`
- Deployments: `npm run dev -- deploy deployments list`

## Safe execution

- `--what-if` to dry-run requests
- `--timeout <seconds>` for long waits (watch/promote/deploy)
- `--json` for structured output

## Checklist

- Ensure `deployToken` is configured for the environment.
- Prefer `--id` over name lookups in automation.
