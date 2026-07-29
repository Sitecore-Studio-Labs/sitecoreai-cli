---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Authoring GraphQL authorization refusals (`AUTH_NOT_AUTHORIZED` inside a 200-OK `errors[]` payload) are now handled as a distinct failure class. The transport retries the request on a dedicated settle schedule (~3s/8s/15s/30s, independent of the caller's `maxAttempts`) because a freshly minted CM automation client authenticates instantly while the CM's own role assignment settles asynchronously — a refusal is definitively not applied, so the retry is write-safe. A refusal that persists past the schedule is classified `AUTH_DENIED` (exit 3) with a role-propagation hint instead of the misleading `NETWORK` (exit 4), so orchestrators can tell "not allowed" from "flaky wire". Callers can tune or disable the schedule via `retry.authzSettleDelaysMs`.
