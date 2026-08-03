---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Package ownership metadata now carries a team identity rather than an individual's. `package.json` `author` becomes `Sitecore Studio Labs`, with Liz Nelson moved to `contributors` so authorship credit is preserved rather than dropped. The MCPB bundle manifest (`mcpb/manifest.json`) gets the same team `author`.

`bugs.url` and `homepage` already pointed at the org repo and are unchanged. This is metadata only — no runtime, CLI, or SDK behavior changes.
