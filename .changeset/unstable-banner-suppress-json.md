---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Suppress the `⚠ … unstable surface` banner for `--json` / `--format json` output.

`markUnstable`'s preAction hook wrote the banner to stderr on every unstable-surface invocation (`scai ops brief`, `ops campaign`, `brand`, `agents`). stdout JSON was clean, but a consumer capturing the merged stdout+stderr stream — the orchestrator's spawn, or a `2>&1 | jq` pipe — got the banner prepended and couldn't parse the JSON. The banner is now suppressed for machine-readable output, exactly as it already honors `--quiet`; the human path is unchanged.
