---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix phantom `cms-edit` merge conflicts on repeated `recipe push` to the same site — the baseline now records applied state, not desired state.

- **HTTP baseline storage on recipe push**: when `SYNC_BASELINE_ENDPOINT_URL` / `SYNC_BASELINE_AUTH_TOKEN` are present (orchestrator-injected), push baselines persist to the shared sync-baseline store instead of a local file that dies with an ephemeral sandbox. Local file remains the fallback.
- **Applied-state baseline capture**: the post-apply baseline writer now keys off the executed plan — fresh creates, executed updates, and proven-in-sync skips are baselined; ADOPTED creates (fields never written) and `cms-wins` / `create-only` / `unresolved` skips are not. Over-capturing those planted baselines the tenant never held, which every later push misread as a tenant author edit (a self-perpetuating exit-6 conflict).
- **GUID-list comparison is representation-insensitive**: `__Masters` / `__Base template` / droplink values compare and hash canonically (brace form, case; order preserved) instead of byte-for-byte.
- **Deterministic per-recipe insert options**: the per-recipe `site-data-folder-insert-options` emit dedupes + sorts its template handles (matching the shared aggregate), so a regenerated recipe with reordered datasource templates no longer drifts the rendered field value.
- `PlannedAction` gains an optional machine-readable `skipKind` (`unresolved` / `in-sync` / `create-only` / `cms-wins`); `ExecutionResult` gains `adoptedItemRefKeys`.
