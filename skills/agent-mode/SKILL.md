---
name: agent-mode
description: Run the CLI safely in non-interactive or CI environments. Use when the user mentions agents, CI, non-TTY, automation, or headless runs.
---

# Agent Mode (Non-Interactive)

## Defaults to enforce

- `--non-interactive` to disable prompts
- `--json` for machine-readable output
- `--log-file <path>` to capture logs

## Environment flags

- `SITECOREAI_NON_INTERACTIVE=1`
- Use `--what-if` for deploy dry-runs

## Checklist

- Avoid name-based lookups; prefer explicit `--id`.
- Use `--timeout` for watch/promote/deploy operations.
- Capture exit codes and parse JSON output.

## Reference

- See `AGENT_CI.md` for full CI guidance and exit codes.
