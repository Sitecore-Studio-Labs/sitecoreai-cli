---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**BREAKING: Canonical `ScaiEnvelope` shape for every `--json` CLI output.**

Before this change, scai emitted three different keys for "the primary
payload" depending on which surface produced the output:

- `result` — deploy commands (`printDeployResultWithContext`)
- `results` — hygiene audit/cleanup commands (`printReport`)
- `request` — deploy what-if (`printDeployWhatIf`)

Agents parsing CLI output had to branch on shape per-command. This
release unifies all three on `data` and introduces a single
`ScaiEnvelope<T>` type (`src/shared/envelope.ts`) that every CLI
command emits under `--json`:

```jsonc
{
  "command": "deploy.environments.list",
  "environment": "demo",
  "data": <T>,            // primary result (object, array, scalar, or null)
  "count": 30,            // when data is an array
  "totalCount": 100,      // when paginated and known
  "pageSize": 50,         // when paginated
  "whatIf": true,         // when plan-only
  "ignoredCount": 3,      // when baseline filtering applied
  "summary": "...",       // human-readable headline
  "meta": { /* command-specific extras */ }
}
```

A new `buildScaiEnvelope(...)` helper handles the assembly: it
auto-computes `count` for array data, hoists canonical envelope keys
from the `extra` bag to envelope-level, and collects everything else
under `meta` so the top-level namespace stays reserved for structured
slots.

**Migration for downstream consumers parsing scai `--json`:**

- `envelope.result` → `envelope.data` (deploy commands)
- `envelope.results` → `envelope.data` (hygiene commands)
- `envelope.request` → `envelope.data` (deploy what-if)
- Extra fields previously spread at envelope root (e.g. `root`,
  `scannedCount`) are now under `envelope.meta`. Pagination
  fields (`totalCount`, `pageSize`) stay at root because they're
  canonical envelope keys.
- `audit.all` envelope: the flat denormalized findings list moved from
  `results` to `data`. The structured `audits` map and `counts` block
  are unchanged.

The MCP tool output envelope (`CallToolResult.structuredContent`) is a
separate MCP protocol shape and is not affected by this change.
Serialization commands that emit non-envelope payloads (the
`info`/`env` outputs that ship structured fields like `excludedFields`
and `modules` at root) are out of scope for this release; their
unification is a follow-up.
