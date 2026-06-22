---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(sdk): export `./sites` + surface `discoverSites` on `./recipe`

Adds `@sitecoreai-labs/sitecoreai-cli/sites` (the Sites API client barrel) to the
package exports, and surfaces `discoverSites` (+ `DiscoveredSite` /
`DiscoverSitesOptions`) on the published `./recipe` entry. Both let SDK consumers
(the orchestrator's deploy/install path) use scai's site discovery + Sites API
directly instead of re-implementing them. No CLI runtime change.
