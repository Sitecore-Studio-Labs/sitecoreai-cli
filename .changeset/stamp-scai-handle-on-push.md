---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix `recipe push` leaving items with an empty `Scai Handle` marker. The plain push path bootstrapped the marker field on the Standard Template but never wrote its value — only the sync path ran `injectHandleMarker` — so items pushed via `recipe push` lost their recipe identity and matching fell back to path/name. `recipe push` now stamps the recipe handle onto every `CreateItem` op (compiled recipes and pre-compiled `.ir.json` inputs alike), matching the sync path. The stamp is idempotent.
