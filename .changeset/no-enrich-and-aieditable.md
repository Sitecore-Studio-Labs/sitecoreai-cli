---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`scai brand sync`: `--no-enrich` flag + always-lock operator PATCHes

Two changes that materially affect how `scai brand sync push`
interacts with Sitecore AI's brand-kit pipeline:

**New: `--no-enrich` flag.** Power-user knob that skips every code
path that would trigger a `BrandIngestionPipeline` /
`EnrichSectionsPipeline` run on Sitecore. With the flag set:

- the kit-creation path becomes an error (`INPUT_INVALID`) instead
  of seeding — sections only exist after enrichment, so PATCHes
  can't land on a fresh kit;
- the self-heal cycle (existing kit where none of the recipe's
  section/field targets are reachable) is skipped;
- the field-PATCH loop still runs. Operator-authored values land on
  whatever sections happen to exist; missed targets are surfaced as
  `skipped` with a diagnostic naming the live-kit structure.

Useful when iterating on field values against a kit you know is
already structured correctly and you don't want to wait 5–15 min
for the pipeline.

The flag is exposed on the underlying `SyncContext` as
`skipEnrichment: boolean` so MCP tools / programmatic callers can
route the same intent.

**Always-lock operator PATCHes via `aiEditable: false`.** Every call
to `updateBrandKitField` from `brandKitKind.apply()` now sets
`aiEditable: false` on the target subsection. Sitecore's
EnrichSections pipeline is asynchronous — it can keep writing field
content for minutes after `seedBrandKit` returns (we only poll
until sections _appear_, not until enrichment finishes). Without
the lock, a late-arriving enrichment write overwrites the recipe
value mid-PATCH, surfacing as "the values I authored vanished
after the push." The flag pins each PATCHed field to its
recipe-provided value so future enrichment runs can't touch it.
