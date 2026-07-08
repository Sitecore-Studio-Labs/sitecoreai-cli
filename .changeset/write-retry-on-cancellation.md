---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe pushes now retry a write when the Authoring API returns a server-side "operation was canceled" — the failure a heavy localize pass hits when a batch of language-version writes exceeds the endpoint's timeout (`[NETWORK] Authoring GraphQL errors: The operation was canceled.`). A cancelled operation is aborted and rolled back, so it never applied and re-sending it is safe. Writes stay fail-fast on everything else (408/425/429/503 and ambiguous aborts / `fetch failed` can all be returned AFTER the mutation applied, so retrying them risks a duplicate) — a new `retryAmbiguousNetwork` gate keeps those out of the write path while the cancellation branch (unambiguously did-not-apply) is honored.
