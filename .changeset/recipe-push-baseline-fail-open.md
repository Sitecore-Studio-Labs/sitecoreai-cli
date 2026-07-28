---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe push` baseline storage is now fail-open: a baseline load or write error (HTTP 4xx/5xx from the remote store, network failure, disk error) logs a warning and degrades that recipe to no-baseline semantics instead of failing the whole push with exit 6. A load failure means the recipe plans as first-push/two-way; a write failure after a successful apply leaves the push successful, and the next push simply re-classifies those fields as first-push.
