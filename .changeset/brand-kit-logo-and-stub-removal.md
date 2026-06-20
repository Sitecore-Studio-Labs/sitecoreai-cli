---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Brand kit recipe: add a `logo` URL field, and remove the broken synthesized-stub-document path.

- The brand-kit recipe now carries an optional `logo` — a PNG URL the brand-kit UI renders directly. It is converged via a new `updateBrandKitLogo()` kit-level PATCH on both freshly-created and pre-existing kits, read back in `readCurrent`, and diffed idempotently (an omitted `logo` leaves the live value unmanaged).
- `synthesizeBrandStubDocument` is removed. Its `data:` URL was never fetched by Sitecore, so the self-heal path always timed out (~15 min waiting for sections) and marked fresh kits `failed`. The canonical sections are materialized on **publish**, so a recipe with no source document now creates the kit via `createBrandKit → publishBrandKit` (real operator documents still go through `seedBrandKit` + ingestion/enrichment), and self-heal publishes an unpublished kit instead of synthesizing a stub. This also makes `--no-enrich` coherent with kit creation.
