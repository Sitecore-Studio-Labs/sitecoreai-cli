---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Data-folder Insert Options now resolve through the component's actual
datasource templates everywhere a folder restricts inserts to "this
component's datasource type".

Components using the external-template patterns (`datasource.template`
or the compatible-datasources `datasource.templates[]`) never create a
template under their own handle, but three emitters referenced
`templateId(site, recipe.handle)` regardless — a refKey no CreateItem
defines, which the executor writes to the tenant as a literal broken
GUID:

- the legacy per-recipe `<Component> Data Folder`'s Insert Options
  (link-list class),
- the shared `<Subfolder> Data Folder` Insert Options union
  (per-contributor handles),
- the `__site-data-root__` aggregate, which additionally referenced the
  legacy per-recipe template id for recipes whose site locations all
  declare `allowedTemplates` — those recipes only emit per-LOCATION
  templates (avatar-block class), so the aggregate now mirrors the
  emitter's template selection exactly.
