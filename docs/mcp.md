# `scai mcp serve` — Model Context Protocol server

`scai mcp serve` launches a Model Context Protocol (MCP) server bound
to a single Sitecore XM Cloud environment for the lifetime of the
process. Agents that speak the MCP protocol (Claude Code, Claude
Desktop, Cursor, Cline, and others) can connect via stdio and drive
scai's developer-side surfaces — deploy, serialization, and recipes
— as agent tools.

## What MCP is

MCP is a JSON-RPC-over-stdio protocol that lets an LLM-driven agent
talk to a fleet of independently-owned tools without bespoke
integrations per tool. Each MCP server publishes:

- **Tools** — typed functions the agent can call.
- **Resources** — read-only URIs the agent can fetch.
- **Prompts** — slash-command-style templates the agent can present
  to the user.

scai's MCP server is the **developer-side counterpart** to Sitecore's
managed Marketer MCP. The marketer surface operates pages, components,
and content from the marketer's vantage point; the scai surface
operates deployment runs, environment lifecycle, source-control
bindings, serialization sync, and Recipe DSL execution.

## Quickstart

```bash
# 1. Configure scai (one-time, or re-use an existing config).
scai setup init

# 2. Authenticate.
scai setup login --environment-name dev

# 3. Launch the MCP server.
scai mcp serve --environment-name dev
```

The startup line lands on stderr:

```
scai mcp serve listening on stdio, bound to environment 'dev'
```

stdout is exclusively reserved for JSON-RPC frames — nothing else
should ever land there. (See [Security + stdout discipline](#security--stdout-discipline).)

### Client configurations

#### Claude Code (project-scoped `mcp.json`)

```json
{
  "mcpServers": {
    "scai-dev": {
      "command": "scai",
      "args": ["mcp", "serve", "--environment-name", "dev"]
    }
  }
}
```

#### Claude Desktop (global `claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "scai-dev": {
      "command": "scai",
      "args": ["mcp", "serve", "--environment-name", "dev"]
    }
  }
}
```

#### Cursor / Cline / others

Use the same `command` + `args` shape against whichever MCP
configuration file the client supports.

## Environment binding

One server process is bound to one environment, resolved at startup
via `--environment-name` (or `defaultEnvProfile` from
`sitecoreai.cli.json`). Multi-env workflows run multiple processes —
there is no in-protocol environment switch.

This is intentional. Tools are simpler to reason about when the bound
env is implicit; secrets (deploy tokens, OAuth bearer) are loaded
once and never echoed across the wire.

## Write gate — `allowWrite`

Every write tool's input schema declares `allowWrite: boolean`
(defaults to `false`). The dispatcher rejects calls with
`allowWrite !== true` **before any side effect runs**. There is no
session-wide override; `allowWrite` is a per-call consent step.

```jsonc
// Read — no allowWrite needed.
{ "name": "deploy_environment_inspect", "arguments": { "environmentId": "env-1" } }

// Write — requires allowWrite: true.
{ "name": "deploy_environment_lifecycle",
  "arguments": { "action": "restart", "environmentId": "env-1", "allowWrite": true } }
```

The MCP server does not run an "approve writes for the session" UI.
That is by design — the human supervisor approves each write the
agent intends to perform.

## Tool surface

The library exports ~60 fetch/mutate primitives. The tool surface
re-shapes those into **24 workflow-shaped tools** that match how an
agent actually reasons about an XM Cloud tenant:

- `*_inspect` tools fan out reads and return a consolidated snapshot.
- `*_manage` / `*_lifecycle` tools take a discriminated `action`
  input and route to the appropriate write primitive.

Full inventory: `scai mcp tools list` (TSV) or
`scai mcp tools list --json`. Per-tool input schemas:
`scai mcp tools schema [--name <name>]`.

### Tool inventory at a glance

| Domain        | Tools                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bootstrap     | `scai_overview`, `environment_status`                                                                                                                                                                                                                                                                                                      |
| Inspector     | `tools_list`, `tools_schema`                                                                                                                                                                                                                                                                                                               |
| Deploy        | `deploy_organization_inspect`, `deploy_project_inspect`, `deploy_project_manage`, `deploy_environment_inspect`, `deploy_environment_lifecycle`, `deploy_environment_variables`, `deploy_repository_manage`, `deploy_run_inspect`, `deploy_run_start`, `deploy_run_cancel`, `deploy_source_control_inspect`, `deploy_source_control_manage` |
| Serialization | `serialization_inspect`, `serialization_sync`, `serialization_validate`, `serialization_publish`                                                                                                                                                                                                                                           |
| Recipe        | `recipe_compile`, `recipe_diff`, `recipe_plan`, `recipe_push`                                                                                                                                                                                                                                                                              |

## Resources

7 resources for agent self-orientation. Six use the `scai://` scheme
(handled in-process); one is the direct `https://` URI for the
Sitecore API docs site, which compatible MCP clients can fetch
externally:

| URI                              | Content                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `scai://help/overview`           | Markdown overview, binding model, write gate                                                   |
| `scai://help/recipes-grammar`    | Recipe DSL grammar synopsis                                                                    |
| `scai://help/deploy-lifecycle`   | XM Cloud deploy state machine                                                                  |
| `scai://help/sitecore-apis`      | Curated index of Sitecore APIs with deep links into api-docs.sitecore.com and tool mappings    |
| `scai://env/current/manifest`    | Static metadata for the bound environment                                                      |
| `scai://env/current/last-deploy` | Most recent deployment (fetched lazily on read)                                                |
| `https://api-docs.sitecore.com/` | External pointer to the full Sitecore API docs site (companion to `scai://help/sitecore-apis`) |

## Prompts

3 slash-command-style prompts surfaced by compatible clients:

| Name                         | Args                      | Purpose                                                        |
| ---------------------------- | ------------------------- | -------------------------------------------------------------- |
| `scai.deploy_recipe`         | `recipeName`, `targetEnv` | Guided: compile → diff → confirm → push.                       |
| `scai.diff_envs`             | `sourceEnv`, `targetEnv`  | Guided: diff serialized state between two environments.        |
| `scai.recover_failed_deploy` | `deploymentId?`           | Guided: inspect failed deploy, pull logs, propose remediation. |

## Transport

`scai mcp serve` supports two transports, selected with `--transport`.

**stdio** (default) — the server reads JSON-RPC frames from stdin and
writes them to stdout, one frame per line. This is what desktop MCP
hosts (Claude Desktop, Cursor, Cline) spawn directly.

**http** — `scai mcp serve --transport http` runs a Streamable HTTP
listener, so a browser-hosted MCP client — or any client that connects
over a URL instead of spawning a child process — can reach the same
tool surface:

```bash
scai mcp serve --transport http --port 3399
```

The endpoint is `http://<host>:<port>/mcp`. Flags:

| Flag            | Default     | Notes                              |
| --------------- | ----------- | ---------------------------------- |
| `--port <n>`    | `3399`      | Listener port.                     |
| `--host <addr>` | `127.0.0.1` | Bind address. Loopback by default. |

The HTTP transport runs **stateless** — no `Mcp-Session-Id`, a fresh
MCP server per request — because scai's dispatch rwlock already
serializes writes process-wide, so there is no per-session state worth
keeping. Progress notifications still stream back on the per-request
response (same `progressToken` opt-in as stdio).

Security posture:

- Binds to `127.0.0.1` by default. Passing a non-loopback `--host`
  prints a warning — the tool surface becomes network-reachable.
- The `Host` request header is validated against the bound address
  (DNS-rebinding defense: a malicious web page cannot point its own
  hostname at this loopback port).
- CORS is permissive on `Origin` so a browser MCP client from any
  local dev origin can connect. The real boundary is the loopback
  bind, the `Host` check, and the per-call `allowWrite` gate every
  write tool enforces — not origin filtering.

## Progress notifications

`recipe_push` and `serialization_sync` emit MCP
`notifications/progress` frames while they run, so clients with a
`progressToken` see live state instead of staring at a silent tool
call. Other tools currently don't emit progress — they're either
fast reads (sub-second) or single-shot writes.

- **`recipe_push`** — one notification per recipe op
  (`op-start`, `apply-success`, `apply-error`). The message is
  `[<recipe-handle>] op <i>: <op-kind>` (and similar for apply
  events). `total` is intentionally omitted because the compiled op
  count expands at runtime.
- **`serialization_sync`** — one notification per database
  checkpoint (`database-start`, `database-changes-detected`,
  `database-applied`, `database-skipped`).

Clients opt in by passing `_meta.progressToken` on the tool call;
without it, the server skips emission entirely (progress is
strictly opt-in).

## Cancellation

`recipe_push` and `serialization_sync` honor MCP
`notifications/cancelled`. When the client cancels:

- The recipe executor stops _between_ operations and runs the same
  rollback path as a failed op — partially-applied mutations on the
  tenant are reverted using the existing LIFO rollback inventory.
- The serialization tasks stop _between_ databases (in-flight
  requests are not interrupted). Any changes already written to the
  filesystem or pushed to the tenant before the cancel are left in
  place; the next invocation will resume from there.
- The tool result crosses the wire as a `CANCELLED` error envelope
  (exit code 130) so the client doesn't see "success" for work it
  asked to stop.

Other tools (fast reads, single-shot writes) return whatever they
were doing — if the underlying HTTP request was cancellable the SDK
threads the abort through, otherwise the envelope is converted to
`CANCELLED` once the handler returns.

## Known limitations (v1)

- **Single mutex around tool dispatch.** Tool calls serialize through
  a single in-house Promise chain. This keeps library state (token
  cache, fetched env metadata) coherent and side-steps a class of
  race conditions, at the cost of no parallel dispatch.
- **Cancellation is cooperative.** In-flight HTTP requests inside a
  single op (e.g. a multi-second Sitecore GraphQL call) aren't
  interrupted — the executor checks the abort signal _between_ ops /
  databases. Worst-case stop time = the longest single network call.
- **No `watch` tools.** `scai provision serialization watch` is intentionally
  excluded — the finish-then-return shape doesn't fit a watcher.
- **HTTP transport is stateless.** No `Mcp-Session-Id`, no resumable
  streams, no standalone server-initiated SSE stream (`GET /mcp` →
  405). Per-request progress notifications are unaffected. stdio is
  the transport with no such caveat.
- **Inline-TS recipe sources not supported.** `recipe_compile`
  accepts a file path or a pre-parsed JSON recipe object. Compiling
  raw TypeScript source from the agent's wire input is a
  code-injection risk and is out-of-scope.

## Telemetry

In MCP mode, telemetry is **opt-out by default** —
`SITECOREAI_TELEMETRY=false` is set automatically by the
`mcp serve` action.

Opt back in with `--telemetry`:

```bash
scai mcp serve --environment-name dev --telemetry
```

## Security + stdout discipline

The stdio transport breaks if anything except JSON-RPC reaches
stdout. Three layers guard against this:

1. **Env flags set BEFORE any other scai module loads:**
   `SITECOREAI_MCP_SERVE=1`, `SITECOREAI_JSON=1`,
   `SITECOREAI_QUIET=1`, `SITECOREAI_NON_INTERACTIVE=1`. These
   suppress spinners, banners, and stdout JSON dumps in the existing
   task runners.
2. **Consola reporter override** that forwards every log line to
   `process.stderr.write`, regardless of consola's defaults.
3. **Post-build smoke** (`scripts/smoke-mcp.cjs`) that spawns a real
   `scai mcp serve` process, sends a `tools/list` request, and
   verifies stdout contains ONLY JSON-RPC framing. The smoke fails
   the release if stdout discipline regresses.

### What's NOT exposed

Several library functions return secrets. These have NO tool wrapper
and are NOT reachable from the MCP surface:

- `fetchEnvironmentEdgeToken` — environment edge tokens.
- `fetchEnvironmentEditingSecret` — environment editing secrets.
- `fetchSourceControlAccessToken` — source-control OAuth tokens.
- OAuth flow primitives (`acquireAccessToken`,
  `requestClientCredentialsToken`, etc.) — auth is bound at server
  startup, not per call.
- `runGraphQL` / `runAuthoringGraphQL` — arbitrary GraphQL query
  strings are a prompt-injection foot-gun.
- Multipart upload (`uploadDeploymentSource`) — wrong shape for an
  agent; supply a sourceReference from a prior CLI-side upload to
  `deploy_run_start` instead.

Error envelopes flow through `redactSecrets` on both the text
content AND the structuredContent. Tokens and OAuth secrets that
accidentally land in an error path are replaced with `<redacted>`
before crossing the wire.

## Inspecting the surface

`scai mcp tools list` and `scai mcp tools schema [--name <name>]`
expose the same registry the live server uses, without binding to a
tenant. Use these to:

- Confirm the tool count and naming after a scai upgrade.
- Pre-compute JSON schemas for tools whose input shape an agent's
  planner needs to know in advance.
- Diff tool surfaces between scai versions (`scai mcp tools list
--json` is stable across `git diff` runs).

## Error envelope

Every tool error returns:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "What happened: ...\nWhy: ...\nNext: ..."
    }
  ],
  "structuredContent": {
    "code": "AUTH_REQUIRED",
    "exitCode": 3,
    "what": "Authentication required.",
    "why": "Token missing.",
    "hint": "Run scai setup login.",
    "next": "Run `scai setup login` for the bound environment, then restart the MCP server.",
    "docsUri": "scai://help/overview"
  }
}
```

The `code` field uses the same `ScaiErrorCode` union that scai's
typed errors emit elsewhere — so an agent that has seen `AUTH_REQUIRED`
in the CLI's exit code (`3`) will recognise the same shape here.

## See also

- [parity-with-devex.md](./parity-with-devex.md) — where MCP sits
  alongside the rest of the scai surface vs. dotnet DevEx.
- [recipes.md](./recipes.md) — Recipe DSL reference.
- [deploy.md](./deploy.md) — Deploy API reference.
- [serialization.md](./serialization.md) — Serialization sync reference.
