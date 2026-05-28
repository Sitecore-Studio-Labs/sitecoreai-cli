---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`scai brand sync push`: synthesize a stub PDF when the recipe has section data but no source document

Sitecore's Brand Management API has no "create section" endpoint — sections only appear as a side effect of `EnrichSectionsPipeline` running over an uploaded document. A recipe declaring field values but no `documents[]` previously created a bare kit, found zero sections to write into, and reported "Applied 1 change; N skipped" — the live kit ended up blank.

`brandKitKind.apply` now detects this combination (no operator documents + field changes referencing sections) and synthesizes a minimal single-page PDF naming the declared sections. The stub flows through the same `seedBrandKit` create → upload → publish → ingest → enrich pipeline as a real document, producing the canonical section set; the recipe's actual field values then converge via `updateBrandKitField` PATCH calls immediately after.

The synthesis is hand-rolled (no new dependency) and emits a valid PDF 1.4 file under 1KB. Input strings are ASCII-coerced (em-dashes → `-`, smart quotes → `'`/`"`, etc.) so byte counts stay consistent with the Helvetica/WinAnsiEncoding font the PDF references.

Operators with a real brand-guidelines PDF should still declare it in `recipe.documents[]` — the synthesis only fires when no document is supplied. The synthesis path emits a distinguishing log line and tags the document `["scai-synthesized", "stub"]` so downstream filters can recognize it.

**Note:** the synthesis fires on initial kit creation. A pre-existing bare kit (one previously created without sections) won't auto-heal — delete it on the tenant and push fresh to trigger the new path.
