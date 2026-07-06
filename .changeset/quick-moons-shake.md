---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Recipe apply is dramatically faster on large pushes: `updateItem` mutations now flow through a bounded-concurrency flush pool (default 4, tune with `SITECOREAI_APPLY_CONCURRENCY`; set `1` to restore the historical strictly-serial apply). Writes to distinct items overlap on the wire, consecutive writes to the same (item, language, version) cell coalesce into a single `updateItem` call, per-item write order is preserved, and creates/version-adds/read-merge-write ops act as pool barriers so plan reads always see settled state. Failure semantics are unchanged — a pooled failure still rolls back everything applied and aborts, and unregistered-language writes still degrade to skips.
