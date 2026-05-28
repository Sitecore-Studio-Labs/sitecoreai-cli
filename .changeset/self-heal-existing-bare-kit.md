---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`scai brand sync push`: self-heal a pre-existing bare kit on re-push

Companion to the synthesize-stub-PDF feature. When `apply` finds an
existing brand kit by name and there are pending field writes, it now
checks whether the kit has any sections. A kit stuck in the bare
state (created without documents by older scai, or by a direct
`createBrandKit` call) would previously fail every field write
silently — the live kit's `listBrandKitSections` returned `[]`, so
`indexFields` returned an empty map and `index.get(...)` produced
`undefined` for every write, pushing each one into `skipped`. The
operator would see a green job that changed nothing.

`apply` now synthesizes a stub PDF and runs the
upload → publish → ingest → enrich → poll cycle against the existing
kit id via the new `enrichBrandKitWithDocuments` export. After
enrichment produces the canonical section set, the field-PATCH loop
finds targets and the values land. No tenant-side cleanup needed —
the next `scai brand sync push` of a stuck kit heals it.
