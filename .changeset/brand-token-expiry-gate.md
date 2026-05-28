---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`scai brand sync`: gate cached AI-skills token on expiry

Sitecore returns `403 Token has expired` (not 401) for stale Bearers on
the Brand APIs, and `requestBrandApi`'s re-mint path only triggers on 401. A stale OS-keychain entry therefore surfaced as a hard
`BRAND_API_FAILED` on every `scai brand sync push` (and every other
Brand API call) until the keychain entry was manually cleared. The
showcase-orchestrator's `brandkit_deploy` worker hit this immediately
whenever the cached token in a developer's keychain ticked past its
~24h lifetime.

`acquireBrandToken` now decodes the cached token's `exp` claim and
evicts + re-mints when the token is inside a 60s safety margin. New
`isTokenExpired` helper in `shared/jwt.ts` (parallels the local copy
already in `publishing/api/auth.ts`).
