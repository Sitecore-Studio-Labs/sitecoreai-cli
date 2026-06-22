---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): actually bootstrap the `Scai Handle` marker field on push

Recipe identity — rename/move-robust matching plus exact handle recovery —
hangs off a `Scai Handle` field on the Sitecore Standard Template.
`injectHandleMarker` stamped the value onto every `CreateItem`, and
`ensureMarkerField` knew how to create the field, but **nothing called it**.
On a real tenant the field therefore never existed: the Authoring API silently
dropped the marker writes and matching fell back to path/name (so renames/moves
weren't actually robust, and there was no `Scai Handle` to find).

`runRecipePush` now calls `ensureMarkerField` once before applying — idempotent
(a no-op when the field is present), skipped under dry-run, and best-effort so a
bootstrap hiccup degrades to path/name matching rather than failing the push.
