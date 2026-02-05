---
name: ci-smoke-test
description: Run the CLI smoke test in CI. Use when setting up or debugging the headless smoke workflow.
---

# CI Smoke Test

## Command

- `npm run smoke`

## What it verifies

- Build succeeds
- CLI help works
- `telemetry status --json` returns valid JSON

## Checklist

- Run in a non-interactive environment.
- Capture exit codes and logs for CI reporting.
