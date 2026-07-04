---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Page compiler: scoped datasources on compatible-datasources components
(`datasource.templates[]`) now conform to the FIRST listed template.

Previously the per-slot resolution only read the singular
`datasource.template` and fell back to the component handle. For
components using the plural compatible-datasources pattern (link-list
et al.) that fallback references a component-template item such
components never create — fields live on the listed content templates —
so `recipe push` died mid-apply with a raw Authoring GraphQL "Cannot
find a template with the <refKey> id" while every other recipe in the
set applied cleanly.
