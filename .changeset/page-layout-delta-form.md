---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Page `__Final Renderings` is now emitted in the exact delta wire form XM Cloud Pages itself writes (operator-verified against working tenant pages), replacing the canonical full-replace form the Pages editor rejected as malformed:

- **Delta form** (`<r xmlns:p="p" xmlns:s="s" p:p="1">`) merging over the page template's standard values — which supply the `l="{JSON layout}"` device pointer — instead of a canonical document that replaced them. No `<p:da name="l" />` directive on page deltas (partial-design emission is unchanged; the directive is now opt-out via `deltaDeviceDirective`).
- **Page-local datasources ride as `ds="local:/Data/<slot>"`** page-relative paths (Pages' own convention — resolves against the context item, survives page copies) instead of resolved item GUIDs. The parser strips the `/Data/` prefix when reverse-projecting, so round-trips and legacy `local:<slot>` sentinels keep working.
- **Every placement gets a page-unique `DynamicPlaceholderId`** rendering parameter — leaves included, not just placements hosting nested children — matching Pages' per-rendering assignment. Author-set ids are still respected and never re-minted.
