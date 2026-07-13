---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Page recipes can declare a content-affinity facet with an **open,
brand-authored taxonomy**.

`PageRecipe.affinity` is an optional facet (authoring metadata only — the
compiler emits no Sitecore field). A downstream consumer projects it into
the CDP event `ext` custom-data object on the page's VIEW events, so a
guest's affinity emerges from the pages they walk.

`affinity.dimensions` is a map of **axis name → tag list**. The axis set is
open: rather than a fixed `category` / `brand` / `topic` shape, a page may
declare any axes that fit its domain (`material`, `room`, `lifeStage`, …).
Because axis names become flat CDP `ext.<axis>` attribute keys, they are
validated as camelCase (`^[a-z][a-zA-Z0-9]*$`); a facet must still declare
at least one tag on some axis. An optional `weight` sets the page's relative
visit share when the consumer walks the brand's page graph.
