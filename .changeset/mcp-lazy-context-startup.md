---
"@sitecoreai-labs/sitecoreai-cli": patch
---

**MCP startup: defer keychain access until the first tool call.**

Some MCP hosts showed `scai mcp serve` stuck in "still connecting" and
never registered the tool list. The root cause was a startup-order
race: the handler awaited `bindMcpEnvironment` — which reads the deploy
token from the OS keychain — **before** calling
`server.connect(transport)`. On macOS a locked keychain can prompt the
user to unlock (multi-second pause), so the JSON-RPC `initialize`
request sat in the stdin buffer past the client's init timeout.

The serve handler now resolves the config synchronously at startup
(still fails fast on bad config or unknown env), then connects the
stdio transport before any keychain access. The deploy token is fetched
lazily by a memoized `McpContextProvider` on the first tool / resource
/ prompt invocation; concurrent first callers share the in-flight
promise so the keychain prompt surfaces once, not per-call. Failures
are not cached, so a tool call retries after the operator unlocks the
keychain or runs `scai login`.

Tool handler signatures and the `McpContext` shape are unchanged. Only
`buildMcpServer` swaps its `context` option for `getContext:
McpContextProvider`; `bindMcpEnvironment` stays available as a
convenience that combines resolve + token fetch.
