---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe push: the DEPLOY_FAILED summary's `details` now lists plan-time op errors from non-aborted recipes (recipe handle, op label, reason) — e.g. marker-first name-collision guard hits. Previously those pushes failed with "N op error(s)" and an empty `details` array, pointing at a per-op `events[]` payload that downstream log captures routinely truncate, leaving the actual errors invisible.
