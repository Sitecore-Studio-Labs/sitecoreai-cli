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
store raw IPs.

### Where the receiver lives

|             |                                                                                     |
| ----------- | ----------------------------------------------------------------------------------- |
| Repo        | **`Sitecore-Studio-Labs/sitecoreai-cli-telemetry`** (private, same org as this CLI) |
| Package     | `sitecoreai-telemetry-endpoint` — a Hono service on Node                            |
| Endpoint    | `POST /v1/t`                                                                        |
| Default URL | `https://cli-telemetry.sitecoreai.dev/v1/t`                                         |
| Hosting     | Vercel                                                                              |
| Store       | Postgres (`POSTGRES_URL`)                                                           |
| Operator    | Sitecore Studio Labs — the same org that publishes this CLI                         |
| DNS zone    | `sitecoreai.dev`, the same zone as the payload schema at `schemas.sitecoreai.dev`   |

That repo is the place to look when debugging a telemetry problem,
answering a privacy question, or evaluating whether to keep telemetry at
all. Alongside `POST /v1/t` it serves `/v1/docs` and `/v1/openapi.json`,
plus a `/v1/admin` surface gated by Auth0 behind a `telemetry:read` scope.

**How IP anonymization actually works.** The receiver anonymizes before
anything is persisted, not after: `anonymizeIp(getClientIp(...))` runs in
the request-logging middleware, and the anonymized value is what reaches
both the structured log and the `telemetry_traces` row. IPv4 is truncated
to a `/24` (last octet zeroed), IPv6 to its first four groups. When
`TRUST_PROXY` is off the client IP resolves to `unknown` outright. The
approximate region reported in events is derived server-side from CDN
headers (`x-vercel-ip-country` / `x-vercel-ip-country-region`, with
Cloudflare and generic fallbacks) — never from a client-supplied value.

**Retention: there is currently no automatic purge.** Rows in
`telemetry_events`, `telemetry_traces`, and `telemetry_errors` persist
until someone deletes them by hand — the receiver ships no TTL, no
retention job, and no scheduled cleanup. (The only expiry in the service
is a 6-hour in-memory nonce window used for replay/duplicate rejection,
which is unrelated to stored rows.) Anyone tightening the privacy posture
should start here; it is the gap, not the anonymization.

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
