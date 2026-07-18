---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(auth): retry OpenID discovery so a transient network blip doesn't fail the push

`[NETWORK] Identity discovery timed out` intermittently failed a whole recipe push (and, in the orchestrator, a whole install batch). The identity provider's `/.well-known/openid-configuration` was fetched once at the start of every token mint with a 5s abort and no retry, so a momentary DNS / TLS-handshake hiccup, a dropped connection, or a brief 5xx/429 aborted the request and killed the batch.

`fetchDiscovery` now retries with exponential backoff — a transient timeout, network error, or 5xx/429 self-heals instead of failing; a deterministic error (a real 4xx, a permanent DNS failure) still surfaces once attempts are exhausted. Tunable via env: `SITECOREAI_AUTH_DISCOVERY_TIMEOUT_MS` (per-attempt, default 5000), `SITECOREAI_AUTH_DISCOVERY_ATTEMPTS` (default 3), `SITECOREAI_AUTH_DISCOVERY_RETRY_MS` (backoff base, default 300).
