---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Slim the published SDK export surface from 24 subpaths to 10. This is breaking for SDK importers, but is shipped as a patch (0.4.2) because the package has no adopters yet.

- The nine `./unstable/*` subpaths collapse into a single namespaced `./unstable` barrel: `agents`, `brand`, `brandSchema`, `brief`, `briefSchema`, `campaigns`, `campaignsSchema`, `scripting`, `sites`.
- `./config`, `./content`, `./publishing`, `./webhooks`, and `./workflow` are no longer published subpaths — those operations remain available through the `scai` CLI and internally.
- Stable core kept: `./recipe`, `./recipe/unstable`, `./recipe/schema`, `./deploy`, `./serialization`, `./sync`, `./hygiene`, `./errors`, `./envelope`.

This release also folds in the 0.4.x internal simplification pass — unforked REST transport, decomposed recipe compiler/`read-current` god-files, `auth/` + `authoring/` now own their shared primitives (published surface byte-identical), and the lint complexity/depth/params ceilings ratcheted to 30/4/5 with all debt cleared. No public API change from that part.
