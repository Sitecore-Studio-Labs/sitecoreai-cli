---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Brand sync: retry a transient `409 Brand Kit is locked` with backoff.

`requestBrandApi` now opts into the shared transport's retry-with-backoff for `409` (the brand API's only "locked" status). A brand sync push's override pass PATCHes kit fields while Sitecore's background AI enrichment still holds the kit lock; previously that 409 hard-failed the push (exit 7, `Brand Kit is locked by another user`). The idempotent field PATCH now rides out the transient lock (~5 attempts, ~15s of backoff) instead of failing.
