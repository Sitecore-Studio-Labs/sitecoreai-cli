---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(sync): retry Cosmos throttles wrapped in a 5xx body, not just HTTP 429

The 429 retry only fired on `response.status === 429`, but Sitecore's
Orchestrate API sometimes bubbles a Cosmos rate-limit up INSIDE a 5xx with a raw
exception body (`TasksRepository: Error updating item: (TooManyRequests) … Sub
Status: 3200`) and no 429 status — so a throttled task PUT slipped through
unretried and failed the push. The retry now also detects the throttle in the
response body (TooManyRequests / "request rate is too large" / Sub Status 3200),
still gated to idempotent methods only (POST/PATCH creates never retry). Body is
peeked via clone() so the caller still receives an intact response.
