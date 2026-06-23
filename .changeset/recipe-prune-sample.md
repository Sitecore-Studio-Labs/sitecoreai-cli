---
"@sitecoreai-labs/sitecoreai-cli": patch
---

feat(recipe): `recipe prune-sample` + `setup bootstrap --prune-sample` — remove the OOTB sample project

Adds `scai provision recipe prune-sample [project]` (default `click-click-launch`),
which deletes the bundled SXA sample project's subtrees that a fresh XM Cloud
environment ships and that clutter the authoring tree + Pages component list:
`/sitecore/templates/Branches/Project/<project>`, `/sitecore/templates/Project/<project>`,
`/sitecore/layout/Renderings/Project/<project>`, and
`/sitecore/layout/Placeholder Settings/<project>`. The `Project` /
`Placeholder Settings` parents (where your own site lives) are left intact.
Idempotent (missing paths skip; tolerates concurrent-delete races) and destructive
(dry-runs without `--allow-write`). Also surfaced as a `setup bootstrap --prune-sample`
step.
