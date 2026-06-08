---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `brand sync push` still aborting on phantom conflicts against pre-existing baselines.

The previous fix stopped emitting `kit.description`/`kit.industry` cells, but baselines already stored (e.g. in the orchestrator DB) were captured under the old hash and still carry them. `classifyCellHashMaps` unions in baseline keys, so against a stale baseline those retired cells classified as a `conflict` (desired absent, current absent, baseline value — both sides "moved off baseline") and `--conflict-policy error` refused the push. Existing brands therefore stayed broken until re-baselined.

Strip the retired `kit.*` cells from a baseline before classification so a stale baseline behaves like a freshly-captured one — no re-baseline required. Scoped to the brand kind; the shared `classifyHashes` both-moved-is-conflict decision is left intact. Adds a regression test.
