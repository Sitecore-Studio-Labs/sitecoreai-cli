---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(sdk): export `./sites`, `discoverSites`, and `createSiteBinding`

Widens the consumable SDK surface so consumers (the orchestrator's deploy/install
path) stop re-implementing logic scai already owns:

- Adds `@sitecoreai-labs/sitecoreai-cli/sites` (the Sites API client barrel) to
  the package exports.
- Surfaces `discoverSites` (+ `DiscoveredSite` / `DiscoverSitesOptions`) on the
  published `./recipe` entry.
- Adds `createSiteBinding` (+ `SiteBindingInput` / `SiteBindingResult`) on
  `./deploy` — the reusable, CLI-free core of `scai deploy site bind` (idempotent
  SXA Site Grouping field write over an Authoring client). The CLI task now wraps
  it, so there's one implementation.

No CLI runtime change.
