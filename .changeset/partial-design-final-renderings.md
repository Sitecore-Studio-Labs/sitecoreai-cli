---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix partial designs and page designs so their Sitecore layout matches what XM Cloud Pages authors — previously a page using a page design rendered an empty header/footer.

- **Partial designs** wrote their component placements (an SXA delta) into `__Renderings` — the shared field that should carry only the device + JSON-layout shell. They now split across two fields like pages: a shared `__Renderings` shell (`<r><d id l /></r>`) and a per-version `__Final Renderings` delta patched over it (with `deltaDeviceDirective: false`, since the `l=` pointer lives in the shell). The layout service reads a partial's contributions from `__Final Renderings`, so the header/footer now compose onto the page.
- **Partial-design scoped datasources** now emit the page-relative `ds="local:/Data/<slot>"` form (the same wire form Pages writes for a partial design's own datasources) instead of an absolute GUID. The datasource items are still materialised at `<partial-design>/Data/<slot>`, where `local:` resolves for the partial's renderings.
- **Page designs** now always stamp the `__Renderings` device + JSON-layout shell, including the common case where the design is purely partial references with no own layout (previously the field was left empty). Its `__Final Renderings` stays blank, and the `PartialDesigns` reference list is unchanged.
