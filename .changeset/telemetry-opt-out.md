---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Telemetry is now opt-out (enabled by default).** Anonymous usage
telemetry — command names and timings only, never code, arguments, or
credentials — is on by default across the CLI and `scai mcp serve`.
Previously it was opt-in: disabled until consent was recorded.

- **First-run notice, not a prompt.** The interactive `(y/N)` consent
  prompt is replaced by a one-time notice on the first interactive run.
  It explains what's collected and how to opt out, then records the
  default in `settings.telemetryEnabled`.
- **Opt out anytime.** New `scai cli telemetry disable` (and `enable`)
  subcommands write `settings.telemetryEnabled`. The env signals
  `SITECOREAI_TELEMETRY=false` and the cross-tool `DO_NOT_TRACK=1` still
  disable telemetry and always win over the config setting. The redundant
  `DISABLE_TELEMETRY` env var is removed — `SITECOREAI_TELEMETRY=false`
  replaces it.
- **`scai mcp serve`:** the `--telemetry` flag is replaced by
  `--no-telemetry`. Telemetry is on for MCP sessions by default;
  `--no-telemetry` turns it off for the session.

`DO_NOT_TRACK` is honored unchanged — only the "no explicit choice"
case flips from disabled to enabled. See `docs/telemetry-and-privacy.md`.
