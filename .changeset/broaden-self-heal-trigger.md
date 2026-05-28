---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`scai brand sync push`: broaden self-heal to cover all "stuck kit" shapes

Companion fix to the synthesize-stub-PDF + self-heal-bare-kit pair.
The first cut of self-heal only fired when
`listBrandKitSections` returned an empty array. Production testing
on a real tenant surfaced a third stuck shape: sections exist on
Sitecore but with no fields — or with field names that don't match
what the recipe targets. In both cases the field-PATCH loop still
skipped every write silently and the operator saw a green job that
changed nothing.

`apply` now indexes the live kit's sections first, then checks
whether _any_ of the section/field pairs the recipe wants to write
are reachable. If none are, it runs the synthesize → upload →
publish → ingest → enrich cycle on the existing kit. The check
covers all three stuck shapes — zero sections, sections-without-
fields, sections-with-wrong-names — without firing on a partially-
populated kit where some writes already resolve. The new log line
reports the live field count so operators can see at a glance why
self-heal triggered.
