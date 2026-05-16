---
name: agent-mode
description: Run the CLI safely in non-interactive or CI environments. Use when the user mentions agents, CI, non-TTY, automation, or headless runs.
---

# Agent Mode (Non-Interactive)

## Defaults to enforce

- `--non-interactive` to disable prompts
- `--json` for machine-readable output
- `--log-file <path>` to capture logs
- Set `SITECOREAI_AUTO_WIZARD=0` to suppress auto-setup hints

## Environment flags

- `SITECOREAI_NON_INTERACTIVE=1`
- `SITECOREAI_SKIP_DEPLOY_LOOKUP=1` if Deploy API access is unavailable
- Use `--what-if` for deploy dry-runs

## Checklist

- Avoid name-based lookups; prefer explicit `--id`.
- Use `--timeout` for watch/promote/deploy operations.
- Capture exit codes and parse JSON output.
- Avoid `scai cli shell` (interactive-only).

## Reference

- See `AGENTS.md` for the full agent/CI contract, exit codes, and recipes.
