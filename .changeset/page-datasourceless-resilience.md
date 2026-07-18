---
"@sitecoreai-labs/sitecoreai-cli": patch
---

fix(recipe): drop scoped datasources on datasource-less renderings instead of aborting the install

A generated page (page-compose) occasionally places a `scoped` datasource on a layout rendering that ships NO datasource template or inline fields — e.g. a `column-splitter` whose content lives in its placeholders. The per-slot fallback set `templateOf = templateId(<component handle>)`, a template nothing in the set creates, so apply aborted the WHOLE install with a raw `Cannot find a template with the <id> id` GraphQL error (exit 6).

`compilePageRecipe` now detects this at compile — a component that is in the set and declares no `datasource.template`/`datasource.templates` and no inline `fields:` — and drops the scoped slot (surfaced via a new `CompileContext.onWarn` sink, wired to the task logger). The slot is filtered before the layout XML is built, so the rendering renders WITHOUT a datasource (kind:none) and no orphan slot item is created; the rest of the page installs cleanly. External components (not in the set) are unaffected.
