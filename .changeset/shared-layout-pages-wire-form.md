---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`layoutScope: "shared"` now writes the shared `__Renderings` in the wire form XM Cloud Pages itself uses: a root `<p:da name="xsi" />` directive and anchor-less `<r>` elements in document order (attributes uid, s:ds, s:id, s:par, s:ph). The previous anchored partial-design delta form (`p:before`/`p:after`) does not place against the page template's standard-values base, so shared layouts pushed but never rendered. Page `__Final Renderings` and partial-design deltas keep their anchored form unchanged.
