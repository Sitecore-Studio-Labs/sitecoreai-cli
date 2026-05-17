# Verifying Agentic Studio update / delete endpoints

Every Agentic Studio resource was probed against a live tenant on
2026-05-17 (agentic-studio-euw): a throwaway of each kind was created,
read, updated (both `PUT` and re-POST), run where applicable, and deleted.

## Verification results (2026-05-17, agentic-studio-euw)

| Resource          | create | read   | update                           | delete |
| ----------------- | ------ | ------ | -------------------------------- | ------ |
| **agent**         | ✅     | ✅     | ✅ `PUT /api/agents`             | ✅     |
| **skill**         | ✅     | ✅     | ✅ `PUT /api/skills/{id}`        | ✅     |
| **widget**        | ✅     | ✅     | ✅ `PUT /api/widgets/{id}`       | ✅     |
| **mcp**           | ✅     | ✅     | ❌ none                          | ✅     |
| **schema**        | ✅     | ✅     | ✅ re-POST `/schemas/create`     | ❌ 405 |
| **html-template** | ⚠️ 2xx | ❌ 404 | ⚠️ `updateHtmlTemplateAction`    | ❌ 404 |
| **space**         | ✅     | ❌ 404 | ✅ `PUT /api/spaces/{id}/config` | ❌ 404 |

`agent` also runs: `runAgent` streamed output back from a created agent.

### The "re-POST as update" question

Re-POSTing a create endpoint with the same name was tested directly:

- **schema** — ✅ **upserts.** Re-running the `/schemas/create` server
  action with the same name updated the schema in place (description
  A→B). `updateSchema` now does exactly this — no `--unverified` needed.
- **mcp** — ❌ **duplicates.** Re-POSTing `POST /api/custom-mcps` with the
  same name created a _second_ row. A custom MCP has no update; delete
  and recreate instead.

The pattern: a **Next.js server-action create upserts** (schema — and
likely html-template, though its 404 read path blocks confirmation); a
**plain REST `POST` create duplicates** (mcp).

### Still unconfirmed (gated behind `--unverified`)

- **schema delete** — `DELETE /api/schemas/{id}` → 405; no delete server
  action captured.
- **mcp update** — no mechanism (`PUT` 405, re-POST duplicates).
- **html-template** — `update` replays the real `updateHtmlTemplateAction`
  server action (recorded 2026-05-17 — see below), but `GET /api/html-templates`
  → 404, so a template cannot be listed or read back; it is addressed by
  id only. `delete` has no captured endpoint.
- **space** — `POST /api/spaces` (+ `PUT /api/spaces/{id}/config`) work,
  but `GET /api/spaces` → 405 and `GET`/`DELETE /api/spaces/{id}` → 404.
  A space is create-only through the known paths.

The rest of this document explains how to capture and wire the real
endpoints for the ones that don't work yet.

## Discovered server actions (2026-05-17 — `pnpm scan:agentic-actions`)

`scripts/scan-agentic-actions.ts` enumerated the `createServerReference`
call sites in the page JS. Hashes rotate per Agentic Studio deploy — these
are "as of 2026-05-17".

| Action name                | Page                   | Hash (2026-05-17)                            |
| -------------------------- | ---------------------- | -------------------------------------------- |
| `createCustomSchemaAction` | /schemas/create        | `60087ab4468f98b69c7cd3b32c83a5d7b1ca883ff1` |
| `updateSchemaAction`       | /schemas/create        | `60917babdf1fc847d7283062a35be04684162b88a7` |
| `createHtmlTemplateAction` | /html-templates/create | `60702b611beeb3886f6a3d118e6332d1f6a3a29610` |
| `updateHtmlTemplateAction` | /html-templates/create | `6077abcec88bb09d86dd7229fce7031d84a96daa3c` |
| `renameSpace`              | /spaces                | `608639a79f26505b1b7e89699906a23e2530751cf5` |

`createCustomSchemaAction` / `createHtmlTemplateAction` match the constants
already in `api/schemas.ts` / `api/html-templates.ts` — confirmed current.
`updateSchemaAction` and `updateHtmlTemplateAction` are real dedicated
update actions; `renameSpace` renames a space.

**Not found by a page-load scan** — almost certainly lazy-loaded behind a
button or menu (the scanner loads pages, it does not click): an
html-template **delete** action, an html-template **list/read** action
(the list may be a server component with no action), and a space
**delete** action.

## Recorded action payloads (2026-05-17 — `pnpm record:agentic-actions`)

`scripts/record-agentic-actions.ts` captures live write requests while the
operator drives the UI — the hash _and_ the argument payload. The
`updateHtmlTemplateAction` request was recorded in full and `updateHtmlTemplate`
in `api/html-templates.ts` now replays it exactly:

```
POST /html-templates/{id}      Next-Action: 6077abce…
args: [ "{id}", { templateId, name, description, code, tags } ]
```

`createHtmlTemplateAction` was confirmed as `[null, { templateId, name,
code, description, tags }]`. Space create / rename were confirmed as plain
REST (`POST /api/spaces`, `PUT /api/spaces/{id}/config`).

**Space delete — confirmed unavailable.** A recording in which the operator
deleted a space captured no delete request: the only calls were the
`601817a6…` action — three idempotent `200`s on the same space id, i.e. a
read ("load space"), not a delete. With `DELETE /api/spaces/{id}` also 404,
Agentic Studio exposes no space-delete scai can use; spaces accumulate, and
`agents space` has no `delete` by design.

**Still uncaptured** — an html-template _delete_ action; and the
html-template list/read path is a GET, so the write-recorder can't see it.

## Why these are unverified

The Agentic Studio BFF (`agentic-studio-<region>.sitecorecloud.io`) is an
unversioned, undocumented Next.js app. scai's knowledge of it comes from
**HAR captures** — recordings of the real browser talking to the BFF.
Update and delete simply have not been recorded yet. Two shapes are
possible:

1. **REST** — `PUT` / `DELETE /api/<resource>/{id}`, like agents. This is
   what scai currently guesses.
2. **Next.js server action** — a `POST` to a page route carrying a
   `Next-Action` header, like schema/html-template `create`
   (see `src/agents/api/schemas.ts`). The action hash rotates on every
   Agentic Studio deploy.

## Capturing a HAR

1. Open Chrome (or Edge) and sign in to Agentic Studio for your tenant.
2. Open **DevTools → Network**. Tick **Preserve log**.
3. In the Agentic Studio UI, perform the operation you want to verify —
   e.g. edit a skill and save, or delete a widget.
4. In the Network panel, find the request that carried the change.
   Right-click → **Save all as HAR with content**.

Scrub the HAR before sharing it — it contains your session cookie and
bearer token. `scai`'s own logs are redacted; a raw HAR is not.

## Reading the capture

Find the request fired by the save/delete click and note:

- **Method + URL** — e.g. `PUT https://…/api/skills/{id}` or
  `POST https://…/skills/{id}/edit`.
- **Request headers** — a `Next-Action: <hash>` header means it is a
  **server action**, not REST. Also capture `Next-Router-State-Tree`.
- **Request body** — the JSON (REST) or the RSC-encoded argument tuple
  (server action).

## Feeding it back into scai

### Case 1 — REST, and it matches the guess

If the request is `PUT` / `DELETE /api/<resource>/{id}` with a body that
matches what `update<Resource>` already sends, the guess is correct.
Verify it live:

```sh
scai agents skill update my-skill -f my-skill.skill.yaml --unverified --apply
scai agents widget delete my-widget --unverified --apply
```

Then drop the guard: remove the **UNVERIFIED** notes from the API file
header and the function doc comments in `src/agents/api/<resource>.ts`,
remove the `requireUnverified(...)` call from that resource's `runUpdate`
/ `runDelete` in `src/agents/tasks/resources.ts`, and drop the
`--unverified` option + description warning from `createResourceGroup` in
`src/commands/agents/index.ts`.

### Case 2 — REST, but a different path or body

Correct the `update<Resource>` / `delete<Resource>` function in
`src/agents/api/<resource>.ts` to match the captured request, then verify
with `--unverified` and remove the guard as in Case 1.

### Case 3 — it is a server action

Run `pnpm scan:agentic-actions` first — it opens a browser, you sign in,
and it enumerates every `createServerReference(...)` (hash + name) across
the Agentic Studio pages. That gives you the action hash and name; the
HAR gives you the `routerStateTree` and argument payload.

Model it on `createSchema` in `src/agents/api/schemas.ts`:

- Add the action to `discoverActionHash` in
  `src/agents/session/playwright-login.ts` so `scai agents login`
  captures the rotating hash automatically.
- Store a last-resort constant + a `SITECOREAI_<RESOURCE>_<OP>_ACTION`
  env override, exactly as `SCHEMA_CREATE_ACTION` does.
- Build the `routerStateTree` and the `args` tuple from the capture.

## Quick probe without a full HAR

`--unverified` is itself a verification tool. Running the guessed call
against a live tenant tells you whether the guess is right:

```sh
scai agents schema delete throwaway-schema --unverified --apply
```

- `2xx` / "Deleted …" → the guess works (proceed as Case 1).
- `404` → wrong path; capture a HAR (Case 2 or 3).
- `405 Method Not Allowed` → the path exists but the verb is wrong —
  likely a server action (Case 3).

Use a throwaway resource so a wrong guess cannot damage real content.
