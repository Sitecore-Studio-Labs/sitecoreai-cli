---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai mcp serve` — built-in Model Context Protocol server.** Launches
a stdio MCP server bound to a single Sitecore environment, exposing
scai's developer-side library surfaces (deploy + serialization +
recipe) as agent tools. Developer-side counterpart to Sitecore's
managed Marketer MCP — complementary, not competing.

**Surface:**

- **24 workflow-shaped tools** across deploy (12), serialization (4),
  recipe (4), bootstrap (2), inspector (2). Tools consolidate
  multiple library primitives into task-shaped operations using
  `*_inspect` snapshots and `*_manage` / `*_lifecycle` discriminated
  `action` inputs. Never 1:1 wrappers — that's an MCP anti-pattern.
- **5 resources** for agent self-orientation:
  `scai://help/{overview,recipes-grammar,deploy-lifecycle}` and
  `scai://env/current/{manifest,last-deploy}`.
- **3 prompts** (`scai.deploy_recipe`, `scai.diff_envs`,
  `scai.recover_failed_deploy`) as compatible-client slash commands.

**Write gate:** every write tool's input schema declares
`allowWrite: boolean` (defaults false). The dispatcher rejects calls
with `allowWrite !== true` before any side effect runs. Per-call
consent — no session-wide override.

**Inspector CLI:** `scai mcp tools list` (TSV) and
`scai mcp tools schema [--name <name>]` for offline introspection
without binding to a tenant.

**Transport:** stdio only in v1. HTTP / SSE deferred to v2.

**Stdout discipline:** the MCP serve action sets
`SITECOREAI_MCP_SERVE=1`, `SITECOREAI_JSON=1`, `SITECOREAI_QUIET=1`,
`SITECOREAI_NON_INTERACTIVE=1` BEFORE any other scai module loads,
and installs a consola reporter that forwards every log line to
stderr. A new post-build smoke (`scripts/smoke-mcp.cjs`, wired into
`pnpm smoke`) verifies stdout contains ONLY JSON-RPC frames.

**What's NOT exposed:** edge tokens, editing secrets, source-control
OAuth tokens, deploy access tokens, generic GraphQL escape hatches,
multipart uploads, and watcher commands all stay off the tool
surface by design.

**Known v1 limitations:**

- Tool calls serialize through a single mutex; no parallel dispatch.
- No cancellation. Long-running tools finish-then-return.
- No streaming partial results.
- No HTTP transport.
- Inline-TS recipe sources not supported (`recipe_compile` accepts
  a file path or a pre-parsed JSON recipe object).

**Dependency:** `@modelcontextprotocol/sdk@^1.29.0` (dual ESM/CJS;
TypeScript types resolve through the SDK's `typesVersions` block
under scai's existing `moduleResolution: "node"` config).

**Docs:** [docs/mcp.md](docs/mcp.md) for the full reference;
[docs/parity-with-devex.md](docs/parity-with-devex.md) lists MCP under
"Added in scai"; [README.md](README.md) has a quickstart.
