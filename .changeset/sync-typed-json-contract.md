---
"@sitecoreai-labs/sitecoreai-cli": minor
---

sync: emit a typed `--json` contract for push/pull/diff + add `scai capabilities`

Recipe sync (brand-kit, brief, brief-type, campaign) previously flattened its
already-typed plan / conflict / identity data to human text at the CLI boundary,
forcing the orchestrator to regex stdout, read resolved Sitecore UUIDs from a
side-channel file (`--identities-out`), and gate features behind `SCAI_HAS_*`
env booleans. This adds a single versioned contract
(`src/sync/contract.ts`, `SYNC_CONTRACT_VERSION = "1"`):

- `brand|brief|campaign sync push/pull/diff --json` now emit one `ScaiEnvelope`
  whose `data` is a typed `SyncResult` — the plan with per-cell `classification`,
  the resolved three-way-merge `conflicts`, and the resolved Sitecore
  `identities`. Under `--json` the entire stdout is the envelope, so consumers
  `JSON.parse` it instead of scraping prose.
- A pull that finds nothing on the tenant now emits `meta.found:false` (exit 0)
  instead of throwing, so callers stop regexing `/not found/`.
- Three-way-merge `POLICY_DENIED` errors now carry structured
  `conflicts: [{ path, classification }]` (in addition to the existing
  `details` strings).
- New top-level `scai capabilities --json` handshake (contract version +
  advertised `features` + `kinds` + conflict policies) so an orchestrator can
  read the capability set once and gate on it, replacing the scatter of
  `SCAI_HAS_*` env probes.

`--identities-out` is retained as a back-compat side-channel. The merge engine
and per-kind logic are unchanged — this is a serialization-boundary change.
