---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**MCP — progress notifications + cancellation for long-running tools.**
`recipe_push` and `serialization_sync` now emit MCP
`notifications/progress` frames while they run AND honor MCP
`notifications/cancelled` for cooperative abort. Stdio transport only;
no HTTP work in this round.

**Progress:**

- `recipe_push` — emits one notification per recipe op (`op-start`,
  `apply-success`, `apply-error`). Message format
  `[<recipe-handle>] op <i>: <op-kind>`. `total` left undefined (the
  compiled op set expands at runtime).
- `serialization_sync` — emits one notification per database
  checkpoint (`database-start` / `database-changes-detected` /
  `database-applied` / `database-skipped`).
- Clients opt in via `_meta.progressToken` on the tool call.
  Without the token the server skips emission — progress is strictly
  opt-in and never load-bearing.

**Cancellation:**

- Adds `CANCELLED` to `ScaiErrorCode` (exit code 130). Minor
  public-API extension — existing consumer code that narrows the
  union must add the new case.
- Recipe executor honors `signal` between operations; partial
  mutations are rolled back via the existing LIFO rollback path.
- Serialization tasks honor `signal` between databases; in-flight
  HTTP requests inside a single op are not interrupted. Filesystem
  / tenant state already applied before the cancel is left in place
  (best-effort cancellation, like `deploy_run_cancel`).
- The dispatcher converts a post-handler aborted signal into a
  `CANCELLED` envelope, so clients see consistent typed errors
  whether the underlying library threw `AbortError` or returned
  normally.

**Tool handler signature change (additive):**

- `ToolDescriptor.handler` now receives a third `extra: ToolExtra`
  argument with `{ signal, progressToken, sendProgress, sendNotification }`.
- Existing tools that don't care about progress/cancel ignore the
  arg — no breaking call-site changes.
- New `dispatchTool` options shape: `{ context, extra }`.

**Library extensions:**

- `executeIr` (`src/recipe/execute.ts`) gains an optional
  `signal: AbortSignal` in `ExecuteOptions`.
- `RecipePushOptions` (`src/recipe/tasks/shared.ts`) gains
  `emit?: (event: { recipe; event: ExecutionEvent }) => void` and
  `signal?: AbortSignal`.
- `SyncOptions` + `DiffOptions` (`src/serialization/tasks/types.ts`)
  gain `SerializationProgressShape` (`{ emit?, signal? }`). New
  exported type `SerializationProgressEvent` describes the event
  union.
- `runPull` / `runPush` / `runDiff` honor signal between databases
  and emit per-database progress events.

**Docs:**

- `docs/mcp.md` — new "Progress notifications" + "Cancellation"
  sections; the v1 limitations list now notes the cooperative
  (between-ops/databases) cancel semantics rather than "no cancel".

**Tests:**

- 4 new MCP unit tests (dispatch pre-aborted, dispatch mid-flight,
  recipe progress forwarding, serialization progress forwarding).
- 1 new integration test (SDK client `AbortController` round-trip).
