---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): partial designs write their layout to the SHARED `__Renderings`
field again, not the default language's `__Final Renderings`

A partial design is a reusable, language-independent design artifact (site
header/footer chrome), so its layout belongs in Sitecore's Shared Layout
(`__Renderings`) — one write that every language version of a page composing
the partial inherits. A prior change split the partial's layout across two
fields, pushing the actual placements into `__Final Renderings @ en`; that
stranded the chrome in the default language's Final layout, so any other
language version — and the Shared Layout view itself — rendered no
header/footer. The compiler now emits the full SXA delta once to `__Renderings`
(with its `<p:da name="l" />` device directive), matching `page-design`'s
shared-layout write and the composition integration test's expectations. The
scoped-datasource `local:/Data/<slot>` wire form is unchanged; only the
destination field moves.
