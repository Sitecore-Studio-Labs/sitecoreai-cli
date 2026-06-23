---
"@sitecoreai-labs/sitecoreai-cli": minor
---

remove `provision recipe prune-sample` + the `setup bootstrap --prune-sample` step

The motivating case — removing the OOTB `click-click-launch` sample — is delivered
as **Items-as-Resources (IAR)**: read-only resource items, not content-database
items. The Authoring `deleteItem` can never remove them (it returns
`successful: false` for every item, including leaves, because there's nothing in the
database to delete). Excluding an IAR sample is a deployment/resource-layer concern
(the planned `provision iar` surface), not an Authoring-delete one — so the command
doesn't belong on the recipe surface. `prune-defaults` (which removes
content-database OOTB folders) is unaffected.
