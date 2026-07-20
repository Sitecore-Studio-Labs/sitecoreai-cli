---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe layout compilation now resolves the SXA dynamic-placeholder token `{*}` in nested placeholder keys instead of appending the `DynamicPlaceholderId` after it.

A nested placement keyed with the shell's placeholder **template** verbatim — e.g. `header-start-{*}`, `footer-main-{*}`, `column-1-{*}` (the shape generators emit when mirroring a shell component's `<slot>-{*}` placeholder) — previously flattened to the doubled key `<parent>/header-start-{*}-1`. No shell surfaces that key: a `<slot>-{*}` component template resolves to `<slot>-<DynamicPlaceholderId>` (`header-start-1`) at render time. The mismatch orphaned every nested child — the container rendering appeared in Sitecore but its sub-components and their datasource content were invisible.

The flattener now REPLACES the `{*}` token with the parent's `DynamicPlaceholderId` (`header-start-{*}` → `header-start-1`), matching what the shell exposes. Bare logical keys (`column-1`, `header-start`) keep the existing append behaviour (`column-1-1`) and emit byte-identical XML, so only `{*}`-tokened nested keys change.
