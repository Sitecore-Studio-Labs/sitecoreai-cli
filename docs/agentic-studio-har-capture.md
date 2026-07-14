# Capturing Agentic Studio endpoints (HAR procedure)

Contributor reference for discovering and wiring Agentic Studio
(`agents` area) endpoints. Agentic Studio's BFF is an unversioned,
undocumented Next.js app, so scai learns its update/delete endpoints by
**capturing HARs** of the real browser talking to the BFF and replaying
them. This document is the reusable procedure for doing that; use it
whenever an `agents` resource operation is gated behind `--unverified`
or when Agentic Studio ships a new resource.

The helper scripts referenced below — `pnpm scan:agentic-actions`
(enumerate `createServerReference` hashes) and `pnpm
record:agentic-actions` (capture a live write request's hash + payload)
— are the two tools that turn a capture into a wired endpoint. Action
hashes rotate on every Agentic Studio deploy, so any hash you capture is
a point-in-time value, not a durable constant; `scai agents login`
rediscovers the current hash via `discoverActionHash`.

## Why an endpoint may be unverified

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
