---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`recipe`: support multi-template datasources (compatible-datasources pattern)

`ComponentTemplateRecipe`'s `datasource` block now accepts a new
`templates: [{ handle }]` array alongside the existing single
`template: { handle }` shortcut (mutually exclusive). When `templates`
is set, the compiler emits a `ref-recipe-list` so each template's
GUID resolves through the executor and pipe-joins into the rendering's
`Datasource Template` shared field — letting the Pages picker surface
items conforming to **any** of the listed templates.

Use this when a single rendering can present multiple content shapes —
e.g. an `avatar-block@1` that accepts either an `author@1` item (rich
author profile) or a focused `avatar@1` item (just name + image +
description). Pair on the React side with a `.sitecore.ts` adapter
that normalises whichever field shape the layout service delivers.

`datasource.template` (singular) continues to work unchanged for the
common single-template case. With `templates` you'll typically want
`autoCreate: false` so the dropping author is prompted to pick a
template via the datasource picker (the compiler can't pick one
unambiguously).
