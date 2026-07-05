---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Page templates chain the SXA page facet set directly — a peer of the
scaffolded collection `Page` template, not a subtype of it.

Reverts the collection-Page inheritance introduced in 0.15.0: recipe
page templates now always inherit Standard template + `Base Page` +
`_Navigable` + `_Taggable` + `_Designable` + `_Sitemap` — the same
facets the SXA-scaffolded `Project/<collection>/Page` itself carries —
per operator verdict on live tenants. Templates that a previous push
pointed at the collection `Page` are rewritten to the facet chain on
the next push. The `SetBaseTemplates.pathBases` mechanism (tenant-path
base resolution with fallbacks) remains available on the op; the
now-unneeded `__page-template-base-templates__` trailing aggregate is
removed.
