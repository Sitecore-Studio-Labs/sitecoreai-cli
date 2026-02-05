---
name: troubleshooting
description: Diagnose common CLI failures and recommend fixes. Use when commands fail, errors are reported, or output is unexpected.
---

# Troubleshooting

## Triage checklist

- Confirm config path and environment name.
- Check auth: deploy token for deploy, OAuth for serialization.
- Re-run with `--trace` and `--json` for more detail.
- Validate config: `npm run dev -- config validate`

## Error classes

- Config or input errors → verify `sitecoreai.cli.json` and flags.
- Auth errors → refresh login or set client credentials.
- Network errors → retry, confirm connectivity, check proxy settings.

## Output handling

- Parse JSON output and exit codes in automation.
