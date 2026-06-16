---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Add schema-only entries for the brand / brief / campaign families:
`@sitecoreai-labs/sitecoreai-cli/unstable/{brand,brief,campaigns}/schema`.

Each re-exports only that family's recipe Zod schemas (e.g. `BrandKitRecipeSchema`,
`BriefTypeRecipeSchema` + `BriefInstanceRecipeSchema`, `CampaignRecipeSchema`, and
their sub-shapes) with a **zod-only** module graph — none of the `/unstable/*`
barrels' API clients, auth (`../shared/jwt`), pipelines, or sync logic. Mirrors the
`./recipe/schema` entry, so a schema-only consumer (e.g. a frontend that re-exports
these schemas into client-reachable code) can import the validators without dragging
the brand/brief/campaign HTTP + auth machinery into its bundle. Export-only and
additive — the existing `/unstable/{brand,brief,campaigns}` barrels are unchanged.
