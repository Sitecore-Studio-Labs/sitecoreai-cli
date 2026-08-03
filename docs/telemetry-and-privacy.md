# Telemetry and privacy

scai sends anonymous usage telemetry, modeled after the Vercel Skills CLI
([github.com/vercel-labs/skills](https://github.com/vercel-labs/skills/)).
This page describes exactly what is sent, where it goes, and how to opt out.

## TL;DR

- Telemetry is **enabled by default** (opt-out). On the first interactive
  run, scai prints a one-time notice and records `settings.telemetryEnabled`
  in `sitecoreai.cli.json`.
- If `settings.telemetryEnabled` is unset, telemetry is **on** — disable it
  with any opt-out signal below.
- Opt out at any time:
  ```sh
  scai cli telemetry disable
  ```
  Or via env vars: `SITECOREAI_TELEMETRY=false` or the broadly-honored
  `DO_NOT_TRACK=1`. An env signal always wins over the config setting.
- Re-enable with `scai cli telemetry enable`.
- Check current state with `scai cli telemetry status`.

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

### Where the receiver lives

|             |                                                                                     |
| ----------- | ----------------------------------------------------------------------------------- |
| Repo        | **`Sitecore-Studio-Labs/sitecoreai-cli-telemetry`** (private, same org as this CLI) |
| Endpoint    | `POST /v1/t`                                                                        |
| Default URL | `https://cli-telemetry.sitecoreai.dev/v1/t`                                         |
| Operator    | Sitecore Studio Labs — the same org that publishes this CLI                         |
| DNS zone    | `sitecoreai.dev`, the same zone as the payload schema at `schemas.sitecoreai.dev`   |

Retention, aggregation, and rate-limit policy are implemented in that repo
— it is the place to look when debugging a telemetry problem, answering a
privacy question, or evaluating whether to keep telemetry at all.

> **Note for maintainers:** the hosting platform and account for
> `cli-telemetry.sitecoreai.dev` are not recorded here because they could
> not be confirmed from this repo alone. The previous default endpoint was
> a Vercel preview-style hostname (`telemetry-api-ten.vercel.app`, replaced
> because it was squattable), which suggests Vercel — confirm against the
> receiver repo before relying on it.

### Overriding the endpoint

The default URL is **compiled into the CLI build** — see
`DEFAULT_TELEMETRY_URL` in `src/telemetry/index.ts`. Override per-invocation
for local development against your own receiver:

```sh
SITECOREAI_TELEMETRY_URL=http://localhost:3000/v1/t scai deploy environments list
```

Because the default is baked in at build time, **every already-published
version of the CLI will POST to `cli-telemetry.sitecoreai.dev` for as long
as it is installed anywhere.** Old versions cannot be repointed. That
hostname therefore has to keep resolving regardless of any future decision
about telemetry — retiring the service means keeping the DNS record and
returning a cheap response, not deleting the zone.

## CLI history (local-only)

Separate from telemetry, scai writes a per-user history log to
`~/.sitecoreai/cli-history.log` (override with `SITECOREAI_HISTORY_PATH`).
This file:

- Stays on your machine. It is never sent to telemetry.
- Has CLI arguments redacted via `src/shared/redact.ts` before write.
- Grows until you delete or rotate it.

View recent activity with `scai cli history`; print the path with
`scai cli history --show-path`.

## Why we collect this

- See which commands are getting used so we know where to invest.
- Catch regressions in command duration after a release.
- Understand rough geographic distribution for SLO planning.

If any of that isn't worth the trade for you, opt out — it doesn't affect
functionality.
