---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Page templates land in their own `Pages` bucket and inherit the
tenant's SXA-scaffolded collection `Page` template.

- `deriveRecipeRoots` now derives `pageTemplates` →
  `/sitecore/templates/Project/<collection>/<site>/Pages`. Previously
  the root wasn't derived at all, so the compiler's fallback dumped
  page templates into the `Components` bucket alongside component
  datasource templates.
- `SetBaseTemplates` gains optional `pathBases` — base templates
  resolved by TENANT PATH at plan/apply time (found → the live item's
  id joins the base list; missing → per-entry `fallbackTemplates`
  join instead). Exists for pre-existing tenant scaffolding whose GUID
  is per-tenant and unknowable at compile time.
- `compilePageTemplateRecipe` uses it: when the site collection is
  known (`sitePathSegment`), page templates inherit
  `/sitecore/templates/Project/<collection>/Page` — the Content Editor
  shows the expected chain and collection-level Page customisations
  flow — falling back to chaining the SXA Foundation page facets
  directly when the scaffold is absent (or the collection unknown),
  which was the previous unconditional behaviour.
