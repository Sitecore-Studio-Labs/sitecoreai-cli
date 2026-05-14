---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**MCP dispatch: parallel reads via an internal read/write lock.**
Previously every tool call serialized through a single Promise-chain
mutex — fine for write-time correctness, but agents issuing read tool
calls (`*_inspect`, `environment_status`, `webhook_inspect`, …) had to
wait their turn even though no shared mutable state was at risk. The
mutex was documented as a v1 limitation.

Replaces the mutex with an in-house rwlock in `src/shared/rwlock.ts`,
threaded through `src/mcp/dispatch.ts`:

- **Reads** (`auth: "read"` descriptors) run concurrently with other
  reads.
- **Writes** (`auth: "write"`) are exclusive against everything —
  preserves the original v1 invariant that mutations don't observe
  each other's half-applied state.
- **Writer preference.** A queued writer is admitted before queued
  readers when a write releases, so a long stream of reads can't
  starve a `recipe_push` waiting for an exclusive slot.

Cancellation, `allowWrite` gating, redaction, and the `CANCELLED`
envelope path are unchanged. The test-only reset helper renames from
`__resetDispatchMutexForTests` to `__resetDispatchLockForTests`; the
old name was never used outside the dispatch test file.
