---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(sync): retry Cosmos 429 (TooManyRequests) on the campaign + brief APIs

A reconnect (or any large story push) sends a burst of campaign →
deliverable → task writes; Sitecore's Orchestrate and Brief APIs sit in
front of Cosmos DB, which rejects requests past the per-second RU budget
with `429 TooManyRequests` (`Sub Status 3200`). `campaignRequest` /
`briefRequest` surfaced that straight up as `CAMPAIGN_API_FAILED` /
`BRIEF_API_FAILED` (exit 8), failing the whole push.

Both transports now retry on 429 via a shared `fetchWithRateLimitRetry`
helper, honoring Cosmos's `x-ms-retry-after-ms` hint (and standard
`Retry-After`) with exponential-backoff + jitter as the fallback. A 429 is
rejected before the request is processed, so the retry is safe even for
non-idempotent writes (PUT/POST/PATCH) — it can't double-apply. Retry count
and backoff base are tunable via `SITECOREAI_HTTP_429_RETRIES` /
`SITECOREAI_HTTP_429_BASE_MS`. Non-429 responses and network errors are
unchanged.
