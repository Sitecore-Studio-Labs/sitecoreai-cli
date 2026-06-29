---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(sync): only retry 429 on idempotent methods (no duplicate campaigns)

0.12.9's Cosmos 429 retry replayed throttled requests for ALL methods. But a
campaign create is a multi-step POST (project → deliverables → tasks), and the
Orchestrate API can apply part of a create before Cosmos throttles a later
step and returns 429 — so retrying that POST DUPLICATES the already-created
entity (observed: duplicate campaigns on regenerate; briefs, being single
marker-adopted entities, were unaffected).

`fetchWithRateLimitRetry` now retries 429 only for idempotent methods
(GET/HEAD/PUT/DELETE/OPTIONS) and surfaces a 429 on POST/PATCH to the caller
unretried. Updates/deletes — the bulk of a re-push / reconnect burst — keep
their throttle-resilience; non-idempotent creates no longer duplicate.
