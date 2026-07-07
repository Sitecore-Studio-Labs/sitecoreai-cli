---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe pushes now align the site-scoped media-library root with the folder the XM Cloud Sites API actually scaffolded for the site (named after the site's DISPLAY name, e.g. `Duke Energy`) when it exists, instead of creating a parallel machine-name sibling (`duke-energy`) — so recipe media and Pages-authored media share one tree. Operator-customized roots and the explicit `--media-library-root` flag are never touched; resolution is best-effort and falls back to the configured root.
