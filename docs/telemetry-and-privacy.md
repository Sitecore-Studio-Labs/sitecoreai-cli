# Telemetry and privacy

scai sends anonymous usage telemetry, modeled after the Vercel Skills CLI
([github.com/vercel-labs/skills](https://github.com/vercel-labs/skills/)).
This page describes exactly what is sent, where it goes, and how to opt out.

## TL;DR

- On first use, scai prompts for telemetry consent and stores the answer
  in `settings.telemetryEnabled` in `sitecoreai.cli.json`.
- If `settings.telemetryEnabled` is unset, **telemetry is disabled** until
  consent is recorded.
- Opt out at any time:
  ```sh
  scai telemetry disable
  ```
  Or via env vars: `SITECOREAI_TELEMETRY=false`, `DISABLE_TELEMETRY=1`, or
  the broadly-honored `DO_NOT_TRACK=1`.
- Check current state with `scai telemetry status`.

## What is sent

Each telemetry event includes:

| Field              | Example                    | Notes                                                                             |
| ------------------ | -------------------------- | --------------------------------------------------------------------------------- |
| Command name       | `deploy environments list` | No full args; sensitive flags redacted                                            |
| Duration           | `1234` (ms)                |                                                                                   |
| CLI version        | `0.0.4`                    |                                                                                   |
| Schema version     | `v1`                       | Payload format version                                                            |
| CI flag            | `ci=1`                     | Present when CI is detected                                                       |
| Approximate region | `US-CA`                    | Derived from CDN headers by the server; client-supplied region values are ignored |
| Nonce              | (random)                   | Per-event, no cross-event correlation                                             |

Payloads are validated against the telemetry schema at
`https://schemas.sitecoreai.dev/v1/telemetry.schema.json` before sending.

## What is not sent

- Full command-line arguments (the CLI redacts secrets and unknown flag
  values before computing the command label).
- File contents.
- Tokens, secrets, or credentials.
- User identifiers (no user ID, no email, no hostname).
- Raw IP addresses (see below).

## Server-side handling

The telemetry service uses client IPs only for rate limiting and does not
store raw IPs (logs keep only anonymized IP prefixes). Retention and
aggregation are determined by the telemetry service.

The default telemetry endpoint is baked into the CLI build. For development,
override with `SITECOREAI_TELEMETRY_URL`.

## CLI history (local-only)

Separate from telemetry, scai writes a per-user history log to
`~/.sitecoreai/cli-history.log` (override with `SITECOREAI_HISTORY_PATH`).
This file:

- Stays on your machine. It is never sent to telemetry.
- Has CLI arguments redacted via `src/shared/redact.ts` before write.
- Grows until you delete or rotate it.

View recent activity with `scai history`; print the path with
`scai history --show-path`.

## Why we collect this

- See which commands are getting used so we know where to invest.
- Catch regressions in command duration after a release.
- Understand rough geographic distribution for SLO planning.

If any of that isn't worth the trade for you, opt out — it doesn't affect
functionality.
