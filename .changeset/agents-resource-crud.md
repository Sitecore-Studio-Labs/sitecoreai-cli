---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai agents` is now organized by resource, with a consistent CRUD surface per kind.**

The `agents` command area used to be a flat list of reads (`agents list`,
`agents skills`, `agents widgets`, …), a single `agents rm`, and `agents
sync`. There was no `agents create/update/delete` grouping, the only
delete used the off-pattern `rm` verb, and HTML templates had no read
command at all — they existed as a recipe kind but were invisible to the
CLI.

Each Agentic Studio resource is now its own subcommand group:

```
scai agents
  agent          {list, get, create, update, delete, duplicate, run}
  space          {get, artifacts, update}
  skill          {list, get, create, update, delete}
  widget         {list, get, create, update, delete}
  schema         {list, get, create, update, delete}
  mcp            {list, get, create, update, delete}
  html-template  {list, get, create, update, delete}   ← `list` is new
  tool           {list}
  sync           {pull, diff, push}
```

- **`agent`** has fully verified CRUD — every write hits a confirmed
  `/api/agents` endpoint. `create`/`update` take a recipe file (the same
  format `scai agents sync` uses). `agent run` now also surfaces the
  finished run's artifacts (the structured output), not just the stream.
- **`space`** is new — the run container. `get` shows its config,
  `artifacts` reads a run's structured output (`/api/spaces/{id}/artifacts`),
  and `update` merges a patch into the live config (rename, change agents
  or context). A space has no list or delete endpoint, so the group has
  neither — all verified 2026-05-17.
- **`skill` / `widget`** have full CRUD — `update` and `delete` were
  verified live on 2026-05-17 against `agentic-studio-euw`.
- **`mcp`** has verified `list` / `get` / `create` / `delete`; it has no
  `update` at all (`PUT` → 405, and re-POSTing the create endpoint
  duplicates rather than upserting) — `update` stays gated.
- **`schema`** has verified `list` / `get` / `create` / `update` —
  `update` re-runs the create server action, which upserts by name
  (verified 2026-05-17). `schema delete` is **UNVERIFIED** (`DELETE` → 405).
- **`html-template`** has `create` and `update` — `update` replays the
  real `updateHtmlTemplateAction` server action, captured live with
  `scripts/record-agentic-actions.ts`. `GET /api/html-templates` returns
  404 on the tested tenant (no list/read path observed), so an
  html-template is addressed by id only and `list` / `get` do not work
  there; `delete` remains **UNVERIFIED**.
- **`tool`** stays read-only — the catalog has no write path.
- **`html-template list`** is new: the resource was reachable only via
  `agents sync` before.

The UNVERIFIED writes are gated behind a new `--unverified` flag and fail
fast with a pointer to `docs/agentic-studio-har-capture.md`, which records
the live verification results and documents how to capture the rest.

**Breaking:** the old flat commands are removed — there are no aliases.
Update any scripts to the resource-grouped paths:

| Removed          | Use instead           |
| ---------------- | --------------------- |
| `agents list`    | `agents agent list`   |
| `agents skills`  | `agents skill list`   |
| `agents tools`   | `agents tool list`    |
| `agents widgets` | `agents widget list`  |
| `agents schemas` | `agents schema list`  |
| `agents mcps`    | `agents mcp list`     |
| `agents run`     | `agents agent run`    |
| `agents rm`      | `agents agent delete` |

Declarative create/update across every kind is still available via `scai
agents sync` — unchanged.

Also fixed: `scai agents login` intermittently failed with "Execution
context was destroyed" — the browser User-Agent was read with
`page.evaluate` after sign-in, racing the Auth0 redirect chain. It is now
captured on the stable blank page before navigation.

Also fixed: `discoverActionHash` (the login-time server-action hash
discovery) never matched — its regex expected `createServerReference("…`
but the minified bundle emits the `(0,x.createServerReference)("…` comma-
expression form, so login silently discovered nothing and the server-action
writes rode their hard-coded fallback hashes. The regex now matches the
real call form (`scripts/scan-agentic-actions.ts` enumerates them).
