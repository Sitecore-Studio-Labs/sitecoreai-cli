---
name: redaction-logs
description: Manage logging, redaction, and output formats safely. Use when the user asks about logs, secrets, or JSON output.
---

# Redaction and Logs

## Output options

- `--json` for machine parsing
- `--quiet` to suppress non-error output
- `--log-file <path>` to capture full logs
- `--trace` for detailed HTTP/debug logging

## Safety checklist

- Never log secrets or tokens directly.
- Prefer JSON output in automation.
- Use `--log-file` for post-run analysis.
