---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai mcp serve --transport http` — Streamable HTTP transport.** The
MCP server is no longer stdio-only. `--transport http` runs a Streamable
HTTP listener at `http://<host>:<port>/mcp`, so a browser-hosted MCP
client — or any client that connects over a URL instead of spawning a
child process — can reach the same 24-tool surface without an external
proxy.

**Flags:** `--transport stdio|http` (default `stdio`), `--port <n>`
(default `3399`), `--host <addr>` (default `127.0.0.1`).

**Stateless:** no `Mcp-Session-Id`, a fresh MCP server per request.
scai's dispatch rwlock already serializes writes process-wide, so there
is no per-session state worth keeping. Progress notifications still
stream back on the per-request response.

**Security:** binds to loopback by default (a non-loopback `--host`
prints a warning); validates the `Host` header against the bound
address as a DNS-rebinding defense; CORS is permissive on `Origin` so a
browser client can connect. The `allowWrite` per-call write gate is
unchanged.
